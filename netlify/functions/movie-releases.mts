import { sendPush, setupPush, subscriptionsByUser, type PushPayload } from '../lib/push'

// Tous les matins : pour chaque film « à voir » des utilisateurs abonnés aux
// notifs, deux nouvelles possibles —
//   • il sort au cinéma en France aujourd'hui (date de sortie en salle TMDB) ;
//   • il vient d'arriver sur une plateforme en abonnement en France.
// Pour les plateformes, on compare à ce qu'on avait vu la veille
// (movie_availability) : un film déjà dispo au premier passage ne déclenche
// rien. movie_notifications empêche de répéter une même nouvelle.
export const config = { schedule: '0 7 * * *' }

type Movie = {
  title: string
  release_dates?: { results: { iso_3166_1: string; release_dates: { type: number; release_date: string }[] }[] }
  'watch/providers'?: { results: Record<string, { flatrate?: { provider_name: string }[] }> }
}

const today = () => new Date().toISOString().slice(0, 10)

export default async () => {
  const tmdbKey = Netlify.env.get('TMDB_KEY') || Netlify.env.get('VITE_TMDB_KEY')
  const setup = setupPush()
  if (!setup.db || !tmdbKey) {
    console.error(`movie-releases : variables manquantes : ${[...(setup.missing ?? []), ...(tmdbKey ? [] : ['TMDB_KEY'])].join(', ')}`)
    return
  }
  const db = setup.db

  const subsByUser = await subscriptionsByUser(db)
  if (!subsByUser.size) return

  const { data: wanted } = await db
    .from('watched_movies')
    .select('user_id, movie_id, title')
    .eq('status', 'later')
    .in('user_id', [...subsByUser.keys()])
  const usersByMovie = new Map<number, string[]>()
  for (const w of wanted ?? []) usersByMovie.set(w.movie_id, [...(usersByMovie.get(w.movie_id) ?? []), w.user_id])
  if (!usersByMovie.size) return

  const { data: known } = await db.from('movie_availability').select('movie_id, providers').in('movie_id', [...usersByMovie.keys()])
  const before = new Map((known ?? []).map((k) => [k.movie_id as number, k.providers as string[]]))

  const v4 = tmdbKey.length > 40
  async function tmdb(id: number): Promise<Movie | null> {
    const qs = new URLSearchParams({ language: 'fr-FR', append_to_response: 'release_dates,watch/providers' })
    if (!v4) qs.set('api_key', tmdbKey!)
    const res = await fetch(`https://api.themoviedb.org/3/movie/${id}?${qs}`, {
      headers: v4 ? { Authorization: `Bearer ${tmdbKey}` } : {},
    })
    return res.ok ? ((await res.json()) as Movie) : null
  }

  async function push(userId: string, movieId: number, kind: string, payload: PushPayload) {
    // La ligne d'abord : si elle existe déjà, cette nouvelle a été envoyée.
    const { error } = await db.from('movie_notifications').insert({ user_id: userId, movie_id: movieId, kind })
    if (error) return
    await sendPush(db, subsByUser.get(userId) ?? [], payload)
  }

  for (const [movieId, userIds] of usersByMovie) {
    const m = await tmdb(movieId).catch(() => null)
    if (!m) continue
    const url = `/#/movie/${movieId}`

    // Sortie en salle en France (types TMDB 2 = limitée, 3 = nationale).
    const fr = m.release_dates?.results.find((r) => r.iso_3166_1 === 'FR')
    const cinema = fr?.release_dates.filter((d) => d.type === 2 || d.type === 3).map((d) => d.release_date.slice(0, 10)).sort()[0]
    if (cinema === today()) {
      for (const u of userIds) await push(u, movieId, 'cinema', { title: 'Au cinéma aujourd’hui', body: `🎬 ${m.title} sort en salle aujourd’hui.`, url })
    }

    // Plateformes en abonnement en France.
    const now = Array.from(new Set<string>((m['watch/providers']?.results.FR?.flatrate ?? []).map((p) => p.provider_name)))
    const prev = before.get(movieId)
    if (prev) {
      for (const p of now.filter((x) => !prev.includes(x))) {
        for (const u of userIds) await push(u, movieId, `stream:${p}`, { title: `Sur ${p}`, body: `🍿 ${m.title} est arrivé sur ${p}.`, url })
      }
    }
    await db.from('movie_availability').upsert({ movie_id: movieId, providers: now, checked_at: new Date().toISOString() })
  }
}
