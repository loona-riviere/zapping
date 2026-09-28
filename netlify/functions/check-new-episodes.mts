import { sendPush, setupPush, subscriptionsByUser } from '../lib/push'

// Tourne une fois par jour : les notifs arrivent avec jusqu'à ~24h de
// retard sur la sortie réelle de l'épisode, pas en temps réel. Suffisant
// pour « au courant qu'un nouvel épisode est sorti », pas pour « pile à
// l'heure de diffusion ».
export const config = { schedule: '0 8 * * *' }

type TrackedRow = { user_id: string; show_id: number }
type Episode = { id: number; season: number; number: number; name: string; airdate: string }

const tmdbKey = Netlify.env.get('TMDB_KEY') || Netlify.env.get('VITE_TMDB_KEY')

async function tmdb<T>(path: string): Promise<T | null> {
  const qs = new URLSearchParams({ language: 'fr-FR' })
  const v4 = tmdbKey!.length > 40
  if (!v4) qs.set('api_key', tmdbKey!)
  const res = await fetch(`https://api.themoviedb.org/3${path}?${qs}`, {
    headers: v4 ? { Authorization: `Bearer ${tmdbKey}` } : {},
  })
  return res.ok ? ((await res.json()) as T) : null
}

/** Les épisodes de la saison en cours (celle du dernier épisode sorti), identifiants TMDB. */
async function fetchEpisodes(showId: number): Promise<Episode[]> {
  const show = await tmdb<{ last_episode_to_air?: { season_number: number } | null }>(`/tv/${showId}`)
  const season = show?.last_episode_to_air?.season_number
  if (!season) return []
  const data = await tmdb<{
    episodes?: { id: number; season_number: number; episode_number: number; name: string; air_date: string | null }[]
  }>(`/tv/${showId}/season/${season}`)
  return (data?.episodes ?? []).map((e) => ({
    id: e.id,
    season: e.season_number,
    number: e.episode_number,
    name: e.name,
    airdate: e.air_date ?? '',
  }))
}

export default async () => {
  const { db, missing } = setupPush()
  if (!db || !tmdbKey) {
    console.error(`check-new-episodes: variables manquantes : ${[...(missing ?? []), ...(tmdbKey ? [] : ['TMDB_KEY'])].join(', ')}`)
    return
  }

  const subsByUser = await subscriptionsByUser(db)
  if (!subsByUser.size) return // personne d'abonné : pas la peine d'interroger TMDB

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

  // TMDB ne donne que le jour de sortie : on prend hier et aujourd'hui (UTC),
  // un peu plus large que le cron quotidien, en sécurité.
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  for (const [showId, userIds] of trackedByShow) {
    const episodes = await fetchEpisodes(showId)
    const justAired = episodes.filter((e) => e.airdate === today || e.airdate === yesterday)
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
