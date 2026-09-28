import { mutedFor, sendPush, setupPush, subscriptionsByUser } from '../lib/push'

// Tourne une fois par jour : les notifs arrivent avec jusqu'à ~24h de
// retard sur la sortie réelle de l'épisode, pas en temps réel. Suffisant
// pour « au courant qu'un nouvel épisode est sorti », pas pour « pile à
// l'heure de diffusion ».
export const config = { schedule: '0 8 * * *' }

type TrackedRow = { user_id: string; show_id: number }
type Episode = { id: number; season: number; number: number; name: string; airstamp: string | null }

async function fetchEpisodes(showId: number): Promise<Episode[]> {
  const res = await fetch(`https://api.tvmaze.com/shows/${showId}?embed=episodes`)
  if (!res.ok) return []
  const data = (await res.json()) as { _embedded?: { episodes?: Episode[] } }
  return data._embedded?.episodes ?? []
}

export default async () => {
  const { db, missing } = setupPush()
  if (!db) {
    console.error(`check-new-episodes: variables manquantes : ${missing.join(', ')}`)
    return
  }

  const subsByUser = await subscriptionsByUser(db)
  if (!subsByUser.size) return // personne d'abonné : pas la peine d'interroger TVmaze

  // Nouveaux épisodes coupés dans ses Paramètres : pas la peine de regarder ses séries.
  const muted = await mutedFor(db, [...subsByUser.keys()], 'episodes')
  const wanted = [...subsByUser.keys()].filter((u) => !muted.has(u))
  if (!wanted.length) return

  const { data: tracked } = await db
    .from('tracked_shows')
    .select('user_id, show_id')
    .eq('status', 'watching')
    .in('user_id', wanted)
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

        await sendPush(db, userSubs, {
          title: 'Nouvel épisode',
          body: `S${String(ep.season).padStart(2, '0')}E${String(ep.number).padStart(2, '0')} — ${ep.name}`,
          url: `/#/show/${showId}`,
        })
      }
    }
  }
}
