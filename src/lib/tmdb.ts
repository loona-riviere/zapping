// Client minimal pour l'API TMDB (films). Nécessite une clé gratuite :
// https://www.themoviedb.org/settings/api → VITE_TMDB_KEY
// Doc : https://developer.themoviedb.org/reference/intro/getting-started

export type Movie = {
  id: number
  title: string
  poster_url: string | null
  year: number | null
  overview: string | null
}

const KEY = import.meta.env.VITE_TMDB_KEY
export const tmdbConfigured = Boolean(KEY)

const BASE = 'https://api.themoviedb.org/3'
const IMG = 'https://image.tmdb.org/t/p/w342'
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 h

type RawMovie = {
  id: number
  title: string
  poster_path: string | null
  release_date: string | null
  overview: string | null
}

function toMovie(r: RawMovie): Movie {
  const year = r.release_date ? Number(r.release_date.slice(0, 4)) : null
  return {
    id: r.id,
    title: r.title,
    poster_url: r.poster_path ? IMG + r.poster_path : null,
    year: Number.isFinite(year) ? year : null,
    overview: r.overview || null,
  }
}

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  if (!KEY) throw new Error("TMDB n'est pas configuré (VITE_TMDB_KEY)")
  const qs = new URLSearchParams({ api_key: KEY, language: 'fr-FR', ...params })
  const res = await fetch(`${BASE}${path}?${qs}`)
  if (!res.ok) throw new Error(`TMDB a répondu ${res.status}`)
  return res.json() as Promise<T>
}

/** Recherche de films, résultats en français, triés par pertinence TMDB. */
export async function searchMovies(query: string, year?: number): Promise<Movie[]> {
  const key = `tmdb:search:${year ?? ''}:${query.toLowerCase()}`
  try {
    const raw = sessionStorage.getItem(key)
    if (raw) {
      const c = JSON.parse(raw) as { at: number; data: Movie[] }
      if (Date.now() - c.at < CACHE_TTL) return c.data
    }
  } catch {
    /* cache illisible : on refetch */
  }
  const params: Record<string, string> = { query, include_adult: 'false' }
  if (year) params.primary_release_year = String(year)
  const data = await get<{ results: RawMovie[] }>('/search/movie', params)
  const movies = data.results.map(toMovie)
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data: movies }))
  } catch {
    /* stockage plein : pas grave */
  }
  return movies
}
