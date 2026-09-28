// Suggestions TMDB : proches d'un titre vu, récents dispos en France, tendances.
import { type Movie, type RawMovie, type RecSignals, KEY, IMG, CACHE_TTL, signals, toMovie, get, readCache, writeCache } from './client'

export type RecMovie = Movie & RecSignals

/**
 * Films recommandés par TMDB à partir d'un film vu — une des listes que
 * l'algorithme de « Recommandé pour toi » croise ensuite (lib/recommend.ts).
 * En localStorage plutôt que sessionStorage : sur iPhone, chaque ouverture de
 * l'icône est une nouvelle session, et on repayait toutes les requêtes.
 */
export async function movieRecommendations(movieId: number): Promise<RecMovie[]> {
  if (!KEY) return []
  const key = `tmdb:movierec:v3:${movieId}`
  const hit = readCache<RecMovie[]>(key, CACHE_TTL)
  if (hit) return hit
  try {
    const data = await get<{ results: RawMovie[] }>(`/movie/${movieId}/recommendations`, {})
    // Plancher de votes : écarte les titres très confidentiels.
    const movies = data.results
      .filter((r) => (r.vote_count ?? 0) >= 20)
      .map((r) => ({ ...toMovie(r), ...signals(r) }))
    writeCache(key, movies)
    return movies
  } catch {
    // Quota TMDB ou panne : une recommandation manquante n'est pas grave.
    return []
  }
}

export type TvRecommendation = {
  id: number
  name: string
  /** Titre original (souvent l'anglais), à côté du titre français de TMDB. */
  originalName: string
  poster_url: string | null
  year: number | null
  /** Résumé TMDB, quand on l'a : sert à Gemini pour juger un titre qu'il connaît mal (sorties récentes). */
  overview?: string | null
}

export type RawTvRec = {
  id: number
  name: string
  original_name: string
  poster_path: string | null
  first_air_date: string | null
  overview?: string | null
  vote_count: number
  vote_average?: number
  popularity?: number
  genre_ids?: number[]
}

export const toTvRec = (r: RawTvRec): TvRecommendation => ({
  id: r.id,
  name: r.name,
  originalName: r.original_name,
  poster_url: r.poster_path ? IMG + r.poster_path : null,
  year: r.first_air_date ? Number(r.first_air_date.slice(0, 4)) : null,
  overview: r.overview || null,
})

export type TvRec = TvRecommendation & RecSignals

/** Séries recommandées par TMDB à partir d'une série suivie. */
export async function tvRecommendationsById(tvId: number): Promise<TvRec[]> {
  if (!KEY) return []
  // Le numéro de version change avec la forme des données mises en cache
  // (leçon de movieDetails) : à rebumper si le type change encore.
  const key = `tmdb:tvrec:v5:${tvId}`
  const hit = readCache<TvRec[]>(key, CACHE_TTL)
  if (hit) return hit
  try {
    const data = await get<{ results: RawTvRec[] }>(`/tv/${tvId}/recommendations`, {})
    // Plancher de votes : écarte les séries très confidentielles.
    const recs = data.results.filter((r) => r.vote_count >= 20).map((r) => ({ ...toTvRec(r), ...signals(r) }))
    writeCache(key, recs)
    return recs
  } catch {
    return []
  }
}

/**
 * Plateformes par abonnement en France (identifiants TMDB) : Netflix, Prime
 * Video, Disney+, Apple TV+, Canal+, Max, Paramount+. Sert à ne proposer que
 * des titres réellement regardables, pas juste « populaires quelque part ».
 */
const FR_PROVIDERS = '8|119|337|350|381|1899|531'

/**
 * Titres récents (3 ans) dispos en abonnement en France : les plus populaires
 * et les mieux notés. Candidats « dans l'air du temps » pour Gemini, en plus
 * des titres proches de la bibliothèque et du Top 10.
 */
export async function discoverRecentShows(): Promise<TvRec[]> {
  if (!KEY) return []
  const key = 'tmdb:discover:v1:tv'
  const hit = readCache<TvRec[]>(key, CACHE_TTL)
  if (hit) return hit
  const since = `${new Date().getFullYear() - 3}-01-01`
  const base = {
    with_watch_providers: FR_PROVIDERS,
    watch_region: 'FR',
    with_watch_monetization_types: 'flatrate',
    'first_air_date.gte': since,
    // Pas de journaux, talk-shows, soaps ni programmes jeunesse.
    without_genres: '10763,10767,10766,10762',
  }
  try {
    const [popular, acclaimed] = await Promise.all([
      get<{ results: RawTvRec[] }>('/discover/tv', { ...base, sort_by: 'popularity.desc', 'vote_count.gte': '100' }),
      get<{ results: RawTvRec[] }>('/discover/tv', { ...base, sort_by: 'vote_average.desc', 'vote_count.gte': '300' }),
    ])
    const byId = new Map<number, TvRec>()
    for (const r of [...popular.results, ...acclaimed.results]) byId.set(r.id, { ...toTvRec(r), ...signals(r) })
    const shows = [...byId.values()]
    writeCache(key, shows)
    return shows
  } catch {
    return []
  }
}

export async function discoverRecentMovies(): Promise<RecMovie[]> {
  if (!KEY) return []
  const key = 'tmdb:discover:v1:movie'
  const hit = readCache<RecMovie[]>(key, CACHE_TTL)
  if (hit) return hit
  const base = {
    with_watch_providers: FR_PROVIDERS,
    watch_region: 'FR',
    with_watch_monetization_types: 'flatrate',
    'primary_release_date.gte': `${new Date().getFullYear() - 3}-01-01`,
  }
  try {
    const [popular, acclaimed] = await Promise.all([
      get<{ results: RawMovie[] }>('/discover/movie', { ...base, sort_by: 'popularity.desc', 'vote_count.gte': '200' }),
      get<{ results: RawMovie[] }>('/discover/movie', { ...base, sort_by: 'vote_average.desc', 'vote_count.gte': '500' }),
    ])
    const byId = new Map<number, RecMovie>()
    for (const r of [...popular.results, ...acclaimed.results]) byId.set(r.id, { ...toMovie(r), ...signals(r) })
    const movies = [...byId.values()]
    writeCache(key, movies)
    return movies
  } catch {
    return []
  }
}

/**
 * Affiches des séries et films tendance de la semaine, pour le mur d'affiches
 * de l'écran de connexion. Une seule paire de requêtes par jour ; sans clé
 * TMDB ou en cas d'échec, l'écran se contente de la mire.
 */
export async function trendingPosters(): Promise<string[]> {
  if (!KEY) return []
  const key = 'tmdb:trending:v1'
  const hit = readCache<string[]>(key, CACHE_TTL)
  if (hit) return hit
  try {
    const [tv, movie] = await Promise.all([
      get<{ results: { poster_path: string | null }[] }>('/trending/tv/week', {}),
      get<{ results: { poster_path: string | null }[] }>('/trending/movie/week', {}),
    ])
    // Séries et films alternés, pour un mur varié plutôt que deux blocs.
    const posters: string[] = []
    for (let i = 0; i < Math.max(tv.results.length, movie.results.length); i++) {
      for (const r of [tv.results[i], movie.results[i]]) if (r?.poster_path) posters.push(IMG + r.poster_path)
    }
    writeCache(key, posters)
    return posters
  } catch {
    return []
  }
}
