// Client minimal pour l'API TMDB (films). Nécessite un identifiant gratuit :
// https://www.themoviedb.org/settings/api → VITE_TMDB_KEY
//
// Cette page en propose deux, et on accepte les deux :
//   — « Clé de l'API » (v3), 32 caractères, passée en paramètre d'URL ;
//   — « Jeton d'accès en lecture à l'API » (v4), un JWT, passé en en-tête
//     Authorization. C'est celui que TMDB met le plus en avant.
// Doc : https://developer.themoviedb.org/reference/intro/getting-started

import { setCacheItem } from '../storage'

export type Movie = {
  id: number
  title: string
  poster_url: string | null
  year: number | null
  /** Date de sortie complète, pas seulement l'année — sert à savoir si le film est déjà sorti. */
  release_date: string | null
  overview: string | null
}

export const KEY = import.meta.env.VITE_TMDB_KEY
export const tmdbConfigured = Boolean(KEY)

/**
 * Les variables VITE_* sont figées dans le bundle au moment du build : si la
 * clé manque, c'est qu'elle n'était pas là quand le site a été construit.
 * Reste à savoir laquelle des causes — nom différent, portée Netlify, build
 * antérieur à l'ajout. On expose donc les NOMS vus au build (jamais les
 * valeurs, qui partiraient dans le HTML public) pour trancher sans deviner.
 */
export function buildEnvNames(): string[] {
  return Object.keys(import.meta.env)
    .filter((k) => k.startsWith('VITE_'))
    .sort()
}

const BASE = 'https://api.themoviedb.org/3'
export const IMG = 'https://image.tmdb.org/t/p/w342'
export const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 h

export type RawMovie = {
  id: number
  title: string
  original_title?: string
  poster_path: string | null
  release_date: string | null
  overview: string | null
  vote_count?: number
  vote_average?: number
  popularity?: number
  genre_ids?: number[]
}

/** Signaux de qualité et de genre, pour classer les suggestions plutôt que de garder l'ordre brut TMDB. */
export type RecSignals = { vote: number; voteCount: number; genreIds: number[] }

export const signals = (r: { vote_average?: number; vote_count?: number; genre_ids?: number[] }): RecSignals => ({
  vote: r.vote_average ?? 0,
  voteCount: r.vote_count ?? 0,
  genreIds: r.genre_ids ?? [],
})

export function toMovie(r: RawMovie): Movie {
  const year = r.release_date ? Number(r.release_date.slice(0, 4)) : null
  return {
    id: r.id,
    title: r.title,
    poster_url: r.poster_path ? IMG + r.poster_path : null,
    year: Number.isFinite(year) ? year : null,
    release_date: r.release_date || null,
    overview: r.overview || null,
  }
}

/** Un jeton v4 est un JWT : trois segments base64url, préfixe « eyJ ». */
const isV4Token = (key: string) => key.startsWith('eyJ')

/** Quota TMDB atteint : on lève ça plutôt qu'une Error générique pour que les appelants d'enrichissement (pas critiques) l'ignorent silencieusement sans casser l'affichage. */
export class TmdbPausedError extends Error {}

const PAUSE_KEY = 'tmdb:paused-until'
const DEFAULT_PAUSE = 10 * 60 * 1000 // 10 min, si TMDB ne dit pas combien de temps attendre

function pausedUntil(): number {
  try {
    return Number(localStorage.getItem(PAUSE_KEY) ?? 0)
  } catch {
    return 0
  }
}

/** 429 chez TMDB : on se met en pause, et on ressaie tout seul une fois le délai passé — pas besoin d'y retoucher à la main. */
function pauseFor(ms: number) {
  try {
    localStorage.setItem(PAUSE_KEY, String(Date.now() + ms))
  } catch {
    /* stockage plein : tant pis, on retentera juste plus tôt que prévu */
  }
}

export async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  if (!KEY) throw new Error("TMDB n'est pas configuré (VITE_TMDB_KEY)")
  const until = pausedUntil()
  if (until > Date.now()) {
    throw new TmdbPausedError(`TMDB en pause jusqu'à ${new Date(until).toLocaleTimeString('fr-FR')}`)
  }

  const qs = new URLSearchParams({ language: 'fr-FR', ...params })
  const headers: Record<string, string> = {}
  if (isV4Token(KEY)) headers.Authorization = `Bearer ${KEY}`
  else qs.set('api_key', KEY)

  const res = await fetch(`${BASE}${path}?${qs}`, { headers })
  if (res.status === 401) {
    throw new Error('TMDB a refusé la clé (VITE_TMDB_KEY)')
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After'))
    pauseFor(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : DEFAULT_PAUSE)
    throw new TmdbPausedError('TMDB a atteint sa limite de requêtes')
  }
  if (!res.ok) throw new Error(`TMDB a répondu ${res.status}`)
  return res.json() as Promise<T>
}


export const normalizeTitle = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function readCache<T>(key: string, ttl: number): T | undefined {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return undefined
    const c = JSON.parse(raw) as { at: number; data: T }
    return Date.now() - c.at < ttl ? c.data : undefined
  } catch {
    return undefined
  }
}

export function writeCache(key: string, data: unknown) {
  setCacheItem(key, JSON.stringify({ at: Date.now(), data }))
}

