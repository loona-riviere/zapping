// Films chez TMDB : recherche, fiche détail, durée, sorties.
import { type Movie, type RawMovie, KEY, IMG, CACHE_TTL, toMovie, get, readCache, writeCache } from './client'

/**
 * Durée d'un film, en minutes. TMDB ne la renvoie pas avec la recherche : il
 * faut une requête par film. On la garde en cache local, elle ne change jamais.
 */
export async function movieRuntime(id: number): Promise<number | null> {
  const key = `tmdb:runtime:${id}`
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) return raw === 'null' ? null : Number(raw)
  } catch {
    /* cache illisible : on refetch */
  }
  const data = await get<{ runtime: number | null }>(`/movie/${id}`, {})
  const runtime = typeof data.runtime === 'number' && data.runtime > 0 ? data.runtime : null
  try {
    localStorage.setItem(key, String(runtime))
  } catch {
    /* stockage plein : pas grave */
  }
  return runtime
}

export type MovieDetails = {
  title: string
  year: number | null
  overview: string | null
  genres: string[]
  releaseDate: string | null
  posterUrl: string | null
  runtime: number | null
}

const DETAILS_TTL = 30 * 24 * 60 * 60 * 1000 // 30 j : une fiche TMDB ne change presque jamais

/**
 * Fiche compl\u00e8te d'un film \u2014 titre, ann\u00e9e, r\u00e9sum\u00e9, genres, date de sortie,
 * affiche et dur\u00e9e \u2014 une seule requ\u00eate, mise en cache. Sert \u00e0 afficher la
 * fiche film que le film soit d\u00e9j\u00e0 suivi ou non (repris depuis un r\u00e9sultat
 * de recherche), et, quand l'affiche ou la dur\u00e9e manquent encore en base
 * (ajout par script, import\u2026), \u00e0 les compl\u00e9ter au passage.
 */
export async function movieDetails(id: number): Promise<MovieDetails | null> {
  // Le num\u00e9ro de version change avec la forme des donn\u00e9es mises en cache,
  // pour ne pas resservir ind\u00e9finiment une fiche mise en cache avant l'ajout
  // d'un champ (l'affiche puis la date de sortie sont rest\u00e9es manquantes
  // jusqu'\u00e0 30 jours \u00e0 cause de \u00e7a \u2014 \u00e0 rebumper si le type change encore).
  const key = `tmdb:details:v3:${id}`
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const cached = JSON.parse(raw) as { at: number; data: MovieDetails }
      if (Date.now() - cached.at < DETAILS_TTL) return cached.data
    }
  } catch {
    /* cache illisible : on refetch */
  }
  const data = await get<{
    title: string
    overview: string | null
    genres: { name: string }[]
    release_date: string | null
    poster_path: string | null
    runtime: number | null
  }>(`/movie/${id}`, {})
  const details: MovieDetails = {
    title: data.title,
    year: data.release_date ? Number(data.release_date.slice(0, 4)) : null,
    overview: data.overview || null,
    genres: data.genres?.map((g) => g.name) ?? [],
    releaseDate: data.release_date || null,
    posterUrl: data.poster_path ? IMG + data.poster_path : null,
    runtime: typeof data.runtime === 'number' && data.runtime > 0 ? data.runtime : null,
  }
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), data: details }))
  } catch {
    /* stockage plein : pas grave */
  }
  return details
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

/**
 * Films à l'affiche en France en ce moment, les plus populaires d'abord
 * (deux pages TMDB). Gardés 12 h.
 */
export async function moviesNowPlaying(): Promise<Movie[]> {
  if (!KEY) return []
  const key = 'tmdb:now-playing:v1:FR'
  const hit = readCache<Movie[]>(key, CACHE_TTL / 2)
  if (hit) return hit
  const pages = await Promise.all(
    ['1', '2'].map((page) => get<{ results: RawMovie[] }>('/movie/now_playing', { region: 'FR', page })),
  )
  const byId = new Map<number, RawMovie>()
  pages.flatMap((p) => p.results).forEach((r) => byId.set(r.id, r))
  const movies = [...byId.values()]
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    .map(toMovie)
  writeCache(key, movies)
  return movies
}

/**
 * Films qui sortent bientôt au cinéma en France, du plus proche au plus
 * lointain ; seulement ceux dont la date est à venir et qui intéressent
 * un minimum (popularité), pour ne pas lister les sorties confidentielles.
 */
export async function moviesUpcoming(): Promise<Movie[]> {
  if (!KEY) return []
  const key = 'tmdb:upcoming:v1:FR'
  const hit = readCache<Movie[]>(key, CACHE_TTL / 2)
  if (hit) return hit
  const today = new Date().toISOString().slice(0, 10)
  const pages = await Promise.all(
    ['1', '2', '3'].map((page) => get<{ results: RawMovie[] }>('/movie/upcoming', { region: 'FR', page })),
  )
  const byId = new Map<number, RawMovie>()
  pages.flatMap((p) => p.results).forEach((r) => byId.set(r.id, r))
  const movies = [...byId.values()]
    .filter((r) => r.release_date && r.release_date > today && (r.popularity ?? 0) >= 5)
    .sort((a, b) => (a.release_date ?? '').localeCompare(b.release_date ?? ''))
    .map(toMovie)
  writeCache(key, movies)
  return movies
}

