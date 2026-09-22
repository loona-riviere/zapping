import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

// Tourne une fois par jour : les notifs arrivent avec jusqu'à ~24h de
// retard sur la sortie réelle de l'épisode, pas en temps réel. Suffisant
// pour « au courant qu'un nouvel épisode est sorti », pas pour « pile à
// l'heure de diffusion ».
export const config = { schedule: '0 8 * * *' }

type TrackedRow = { user_id: string; show_id: number }
type SubRow = { user_id: string; endpoint: string; p256dh: string; auth_key: string }
type Episode = { id: number; season: number; number: number; name: string; airstamp: string | null }

async function fetchEpisodes(showId: number): Promise<Episode[]> {
  const res = await fetch(`https://api.tvmaze.com/shows/${showId}?embed=episodes`)
  if (!res.ok) return []
  const data = (await res.json()) as { _embedded?: { episodes?: Episode[] } }
  return data._embedded?.episodes ?? []
}

export default async () => {
  const supabaseUrl = Netlify.env.get('SUPABASE_URL')
  const serviceKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const vapidPublic = Netlify.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate = Netlify.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Netlify.env.get('VAPID_SUBJECT')
  if (!supabaseUrl || !serviceKey || !vapidPublic || !vapidPrivate || !vapidSubject) {
    console.error('check-new-episodes: variables manquantes')
    return
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
  // Clé service_role : bypasse la RLS exprès, seule façon pour une tâche de
  // fond de lire/écrire pour tous les utilisateurs plutôt qu'un seul.
  const db = createClient(supabaseUrl, serviceKey)

  const { data: subs } = await db.from('push_subscriptions').select('user_id, endpoint, p256dh, auth_key')
  const subsByUser = new Map<string, SubRow[]>()
  for (const s of (subs ?? []) as SubRow[]) {
    const list = subsByUser.get(s.user_id) ?? []
    list.push(s)
    subsByUser.set(s.user_id, list)
  }
  if (!subsByUser.size) return // personne d'abonné : pas la peine d'interroger TVmaze

  const { data: tracked } = await db
    .from('tracked_shows')
    .select('user_id, show_id')
    .eq('status', 'watching')
    .in('user_id', [...subsByUser.keys()])
  const trackedByShow = new Map<number, string[]>()
  for (const t of (tracked ?? []) as TrackedRow[]) {
    const list = trackedByShow.get(t.show_id) ?? []
    list.push(t.user_id)
    trackedByShow.set(t.show_id, list)
  }
  if (!trackedByShow.size) return

  const since = Date.now() - 36 * 60 * 60 * 1000 // fenêtre un peu plus large que le cron quotidien, en sécurité
  const now = Date.now()

  for (const [showId, userIds] of trackedByShow) {
    const episodes = await fetchEpisodes(showId)
    const justAired = episodes.filter((e) => {
      if (!e.airstamp) return false
      const t = new Date(e.airstamp).getTime()
      return t >= since && t <= now
    })
    if (!justAired.length) continue

    for (const userId of userIds) {
      const userSubs = subsByUser.get(userId)
      if (!userSubs?.length) continue

      for (const ep of justAired) {
        const { error: insertError } = await db
          .from('episode_notifications')
          .insert({ user_id: userId, show_id: showId, episode_id: ep.id })
        if (insertError) continue // déjà notifié (conflit sur la clé primaire) : on saute

        const payload = JSON.stringify({
          title: 'Nouvel épisode',
          body: `S${String(ep.season).padStart(2, '0')}E${String(ep.number).padStart(2, '0')} — ${ep.name}`,
          url: `/#/show/${showId}`,
        })

        for (const sub of userSubs) {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
              payload,
            )
          } catch (e) {
            const status = (e as { statusCode?: number }).statusCode
            if (status === 404 || status === 410) {
              // Abonnement mort (désinstallé, permission révoquée…) : on nettoie.
              await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
            }
          }
        }
      }
    }
  }
}
