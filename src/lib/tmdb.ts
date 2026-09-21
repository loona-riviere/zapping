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

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
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

/** Identifiant TMDB d'une série à partir de son IMDb ID — le lien ne change jamais, cache long. */
async function resolveTvId(imdbId: string): Promise<number | null> {
  const key = `tmdb:tvid:${imdbId}`
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) return raw === 'null' ? null : Number(raw)
  } catch {
    /* cache illisible : on refetch */
  }
  const found = await get<{ tv_results: { id: number }[] }>(`/find/${encodeURIComponent(imdbId)}`, {
    external_source: 'imdb_id',
  })
  const tvId = found.tv_results?.[0]?.id ?? null
  try {
    localStorage.setItem(key, String(tvId))
  } catch {
    /* stockage plein : pas grave */
  }
  return tvId
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
  // v2 : la cl\u00e9 change avec la forme des donn\u00e9es mises en cache, pour ne
  // pas resservir ind\u00e9finiment une fiche mise en cache avant l'ajout d'un
  // champ (l'affiche est rest\u00e9e manquante pendant 30 jours \u00e0 cause de \u00e7a).
  const key = `tmdb:details:v2:${id}`
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
  const tvId = await resolveTvId(imdbId)
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

const SUMMARY_TTL = 7 * 24 * 60 * 60 * 1000 // 7 j

/**
 * Résumé d'une série en français. TVmaze n'a que l'anglais ; on va chercher
 * la traduction chez TMDB via le pont IMDb. Retourne null sans série
 * d'IMDb ID, sans traduction connue, ou si TMDB est en pause (quota) — dans
 * tous les cas, l'appelant retombe alors sur le texte anglais de TVmaze.
 */
export async function showOverviewFr(imdbId: string | null | undefined): Promise<string | null> {
  if (!KEY || !imdbId) return null
  const key = `tmdb:overview:${imdbId}`
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) {
      const cached = JSON.parse(raw) as { at: number; overview: string | null }
      if (Date.now() - cached.at < SUMMARY_TTL) return cached.overview
    }
  } catch {
    /* cache illisible : on refetch */
  }

  const tvId = await resolveTvId(imdbId)
  if (!tvId) return null
  const show = await get<{ overview: string | null }>(`/tv/${tvId}`, {})
  const overview = show.overview || null
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), overview }))
  } catch {
    /* stockage plein : pas grave */
  }
  return overview
}

/**
 * Résumés de tous les épisodes d'une saison, en français, par numéro
 * d'épisode — une seule requête TMDB couvre la saison entière. Même repli
 * que `showOverviewFr` en cas d'échec.
 */
export async function seasonOverviewsFr(
  imdbId: string | null | undefined,
  season: number,
): Promise<Map<number, string> | null> {
  if (!KEY || !imdbId) return null
  const key = `tmdb:season:${imdbId}:${season}`
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const cached = JSON.parse(raw) as { at: number; episodes: [number, string][] }
      if (Date.now() - cached.at < SUMMARY_TTL) return new Map(cached.episodes)
    }
  } catch {
    /* cache illisible : on refetch */
  }

  const tvId = await resolveTvId(imdbId)
  if (!tvId) return null
  const data = await get<{ episodes: { episode_number: number; overview: string | null }[] }>(
    `/tv/${tvId}/season/${season}`,
    {},
  )
  const episodes = new Map(
    data.episodes.filter((e) => e.overview).map((e) => [e.episode_number, e.overview as string]),
  )
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), episodes: [...episodes.entries()] }))
  } catch {
    /* stockage plein : pas grave */
  }
  return episodes
}

/**
 * Films recommandés par TMDB à partir d'un film aimé. Sert de base aux
 * suggestions « Recommandé pour toi », construites à partir des derniers
 * films vus plutôt que d'un algorithme maison.
 */
export async function movieRecommendations(movieId: number): Promise<Movie[]> {
  if (!KEY) return []
  const key = `tmdb:movierec:${movieId}`
  try {
    const raw = sessionStorage.getItem(key)
    if (raw) {
      const c = JSON.parse(raw) as { at: number; data: Movie[] }
      if (Date.now() - c.at < CACHE_TTL) return c.data
    }
  } catch {
    /* cache illisible : on refetch */
  }
  try {
    const data = await get<{ results: RawMovie[] }>(`/movie/${movieId}/recommendations`, {})
    const movies = data.results.map(toMovie)
    try {
      sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data: movies }))
    } catch {
      /* stockage plein : pas grave */
    }
    return movies
  } catch {
    // Quota TMDB ou panne : une recommandation manquante n'est pas grave.
    return []
  }
}

export type TvRecommendation = { id: number; name: string; poster_url: string | null; year: number | null }

type RawTvRec = { id: number; name: string; poster_path: string | null; first_air_date: string | null }

/**
 * Séries recommandées par TMDB à partir d'une série suivie (résolue via son
 * IMDb ID, le seul pont qu'on a entre TVmaze et TMDB). Ce ne sont que des
 * suggestions à chercher ensuite sur TVmaze : TMDB ne connaît pas
 * l'identifiant TVmaze, donc pas de lien direct vers une fiche.
 */
export async function tvRecommendationsByImdb(
  imdbId: string | null | undefined,
): Promise<TvRecommendation[]> {
  if (!KEY || !imdbId) return []
  const tvId = await resolveTvId(imdbId)
  if (!tvId) return []
  const key = `tmdb:tvrec:${tvId}`
  try {
    const raw = sessionStorage.getItem(key)
    if (raw) {
      const c = JSON.parse(raw) as { at: number; data: TvRecommendation[] }
      if (Date.now() - c.at < CACHE_TTL) return c.data
    }
  } catch {
    /* cache illisible : on refetch */
  }
  try {
    const data = await get<{ results: RawTvRec[] }>(`/tv/${tvId}/recommendations`, {})
    const recs = data.results.map((r) => ({
      id: r.id,
      name: r.name,
      poster_url: r.poster_path ? IMG + r.poster_path : null,
      year: r.first_air_date ? Number(r.first_air_date.slice(0, 4)) : null,
    }))
    try {
      sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data: recs }))
    } catch {
      /* stockage plein : pas grave */
    }
    return recs
  } catch {
    return []
  }
}
