// Client minimal pour l'API TMDB (films). Nécessite un identifiant gratuit :
// https://www.themoviedb.org/settings/api → VITE_TMDB_KEY
//
// Cette page en propose deux, et on accepte les deux :
//   — « Clé de l'API » (v3), 32 caractères, passée en paramètre d'URL ;
//   — « Jeton d'accès en lecture à l'API » (v4), un JWT, passé en en-tête
//     Authorization. C'est celui que TMDB met le plus en avant.
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

/** Un jeton v4 est un JWT : trois segments base64url, préfixe « eyJ ». */
const isV4Token = (key: string) => key.startsWith('eyJ')

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  if (!KEY) throw new Error("TMDB n'est pas configuré (VITE_TMDB_KEY)")
  const qs = new URLSearchParams({ language: 'fr-FR', ...params })
  const headers: Record<string, string> = {}
  if (isV4Token(KEY)) headers.Authorization = `Bearer ${KEY}`
  else qs.set('api_key', KEY)

  const res = await fetch(`${BASE}${path}?${qs}`, { headers })
  if (res.status === 401) {
    throw new Error('TMDB a refusé la clé (VITE_TMDB_KEY)')
  }
  if (!res.ok) throw new Error(`TMDB a répondu ${res.status}`)
  return res.json() as Promise<T>
}

type RawTv = { id: number; name: string; original_name: string; first_air_date: string | null }

/**
 * Titres originaux possibles d'une série cherchée par son titre français.
 *
 * Netflix nomme les séries dans la langue du compte (« À l'ombre des
 * magnolias ») alors que TVmaze n'indexe que le titre d'origine (« Sweet
 * Magnolias »). TMDB, lui, connaît les deux : on s'en sert de dictionnaire
 * pour retraduire avant d'interroger TVmaze.
 */
export async function originalTitlesFor(query: string): Promise<string[]> {
  if (!KEY) return []
  const data = await get<{ results: RawTv[] }>('/search/tv', { query, include_adult: 'false' })
  const seen = new Set([normalizeTitle(query)])
  const out: string[] = []
  for (const r of data.results.slice(0, 5)) {
    for (const candidate of [r.original_name, r.name]) {
      const key = normalizeTitle(candidate ?? '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(candidate)
    }
  }
  return out
}

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

const normalizeTitle = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export type Provider = { id: number; name: string; logo: string | null }
export type Availability = { providers: Provider[]; link: string | null }

const LOGO = 'https://image.tmdb.org/t/p/w92'
const AVAIL_TTL = 7 * 24 * 60 * 60 * 1000 // 7 j : une offre change, mais pas tous les jours

type RawProvider = { provider_id: number; provider_name: string; logo_path: string | null }

/**
 * Où regarder une série, en abonnement, dans un pays donné.
 *
 * On ne suit les séries que par leur identifiant TVmaze : le pont vers TMDB
 * passe par l'IMDb, que TVmaze publie dans `externals`. Sans IMDb, pas de
 * disponibilité — on renvoie null plutôt que de deviner sur le titre, qui
 * rapprocherait des homonymes.
 *
 * Les données viennent de JustWatch via TMDB, à créditer comme telles.
 */
export async function watchProviders(
  imdbId: string | null | undefined,
  region = 'FR',
): Promise<Availability | null> {
  if (!KEY || !imdbId) return null
  const key = `tmdb:where:${region}:${imdbId}`
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const cached = JSON.parse(raw) as { at: number; data: Availability | null }
      if (Date.now() - cached.at < AVAIL_TTL) return cached.data
    }
  } catch {
    /* cache illisible : on refetch */
  }

  let data: Availability | null = null
  const found = await get<{ tv_results: { id: number }[] }>(`/find/${encodeURIComponent(imdbId)}`, {
    external_source: 'imdb_id',
  })
  const tvId = found.tv_results?.[0]?.id
  if (tvId) {
    const res = await get<{
      results: Record<string, { link?: string; flatrate?: RawProvider[] }>
    }>(`/tv/${tvId}/watch/providers`, {})
    const here = res.results?.[region]
    if (here?.flatrate?.length) {
      data = {
        providers: here.flatrate.map((p) => ({
          id: p.provider_id,
          name: p.provider_name,
          logo: p.logo_path ? LOGO + p.logo_path : null,
        })),
        link: here.link ?? null,
      }
    }
  }

  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }))
  } catch {
    /* stockage plein : pas grave */
  }
  return data
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
