// Séries : catalogue TMDB (titres et résumés en français, repli anglais).
// Doc : https://developer.themoviedb.org/reference/tv-series-details
//
// Tout le reste de l'app ne connaît que ces types : l'identifiant d'une série
// ou d'un épisode est celui de TMDB.

import { idbGetMany, idbSet } from './idb'
import { get } from './tmdb/client'

export type TvShow = {
  id: number
  name: string
  /** Titre d'origine (« Casa de Papel ») : aide à retrouver une série importée sous un autre nom. */
  originalName?: string
  image: { medium: string; original: string } | null
  premiered: string | null
  /** 'Running' | 'Ended' | 'In Development' — voir statusFr. */
  status: string
  summary: string | null
  genres: string[]
  /** Note moyenne TMDB, sur 10 — absente pour une série trop récente. */
  rating: number | null
  network: { name: string } | null
  webChannel: { name: string } | null
  externals: { imdb: string | null } | null
}

export type TvEpisode = {
  id: number
  season: number
  number: number
  name: string
  airdate: string
  /** Heure exacte de sortie : TMDB ne donne que le jour. */
  airstamp: string | null
  runtime: number | null
  summary: string | null
  image?: { medium: string; original: string } | null
}

export type ShowWithEpisodes = { show: TvShow; episodes: TvEpisode[] }

const IMG = 'https://image.tmdb.org/t/p/'
const CACHE_TTL = 12 * 60 * 60 * 1000 // 12 h
const inflight = new Map<number, Promise<ShowWithEpisodes>>()

type RawShow = {
  id: number
  name: string
  original_name: string
  poster_path: string | null
  first_air_date: string | null
  status?: string
  overview: string | null
  genres?: { name: string }[]
  genre_ids?: number[]
  vote_average?: number
  vote_count?: number
  networks?: { name: string }[]
  seasons?: { season_number: number; episode_count: number }[]
  external_ids?: { imdb_id: string | null }
}

type RawEpisode = {
  id: number
  season_number: number
  episode_number: number
  name: string | null
  air_date: string | null
  runtime: number | null
  overview: string | null
  still_path: string | null
}

const STATUS: Record<string, string> = {
  'Returning Series': 'Running',
  Ended: 'Ended',
  Canceled: 'Ended',
  'In Production': 'In Development',
  Planned: 'In Development',
  Pilot: 'In Development',
}

const poster = (p: string | null) => (p ? { medium: `${IMG}w342${p}`, original: `${IMG}w780${p}` } : null)

function toShow(r: RawShow): TvShow {
  const channel = r.networks?.[0] ? { name: r.networks[0].name } : null
  return {
    id: r.id,
    name: r.name,
    originalName: r.original_name,
    image: poster(r.poster_path),
    premiered: r.first_air_date || null,
    status: STATUS[r.status ?? ''] ?? r.status ?? '',
    summary: r.overview || null,
    genres: (r.genres ?? []).map((g) => g.name),
    rating: r.vote_count ? (r.vote_average ?? null) : null,
    network: channel,
    webChannel: null,
    externals: { imdb: r.external_ids?.imdb_id ?? null },
  }
}

/** TMDB écrit « Épisode 3 » quand il n'a pas de titre traduit. */
const untitled = (name: string | null) => !name || /^(Épisode|Episode) \d+$/.test(name)

export async function searchShows(query: string): Promise<TvShow[]> {
  const data = await get<{ results: RawShow[] }>('/search/tv', { query, include_adult: 'false' })
  return data.results.map(toShow)
}

/** Une série par son identifiant IMDb (import d'une liste, d'un historique). */
export async function findShowByImdb(imdb: string): Promise<number | null> {
  const found = await get<{ tv_results: { id: number }[] }>(`/find/${encodeURIComponent(imdb)}`, { external_source: 'imdb_id' })
  return found.tv_results?.[0]?.id ?? null
}

type Cached = { at: number; data: ShowWithEpisodes }

const cacheKey = (id: number) => `series:show:v1:${id}`
const memory = new Map<number, Cached>()

/**
 * Fiches déjà en cache, quel que soit leur âge — pour afficher tout de suite
 * la bibliothèque d'un seul bloc, puis rafraîchir en arrière-plan ce qui est
 * périmé.
 */
export async function peekShows(ids: number[]): Promise<Map<number, Cached>> {
  const out = new Map<number, Cached>()
  const missing = ids.filter((id) => {
    const m = memory.get(id)
    if (m) out.set(id, m)
    return !m
  })
  const stored = await idbGetMany<Cached>(missing.map(cacheKey))
  for (const id of missing) {
    const c = stored.get(cacheKey(id))
    if (c) {
      memory.set(id, c)
      out.set(id, c)
    }
  }
  return out
}

export const isFresh = (c: Cached) => Date.now() - c.at < CACHE_TTL

/** Les saisons d'une série, 20 par requête (limite de append_to_response chez TMDB). */
async function fetchSeasons(id: number, numbers: number[], language: string): Promise<RawEpisode[]> {
  const out: RawEpisode[] = []
  for (let i = 0; i < numbers.length; i += 20) {
    const chunk = numbers.slice(i, i + 20)
    const data = await get<Record<string, { episodes?: RawEpisode[] } | undefined>>(`/tv/${id}`, {
      language,
      append_to_response: chunk.map((n) => `season/${n}`).join(','),
    })
    for (const n of chunk) out.push(...(data[`season/${n}`]?.episodes ?? []))
  }
  return out
}

async function fetchShow(id: number): Promise<ShowWithEpisodes> {
  const raw = await get<RawShow>(`/tv/${id}`, { append_to_response: 'external_ids' })
  // Saison 0 = épisodes spéciaux : on les ignore, comme avant.
  const numbers = (raw.seasons ?? []).filter((s) => s.season_number > 0 && s.episode_count > 0).map((s) => s.season_number)
  const fr = await fetchSeasons(id, numbers, 'fr-FR')

  // Pas de traduction pour la fiche ou certains épisodes : l'anglais vaut mieux que rien.
  const missing = fr.filter((e) => untitled(e.name) || !e.overview)
  let en = new Map<number, RawEpisode>()
  let enShow: RawShow | null = null
  if (!raw.overview) enShow = await get<RawShow>(`/tv/${id}`, { language: 'en-US' }).catch(() => null)
  if (missing.length) {
    const seasons = [...new Set(missing.map((e) => e.season_number))]
    en = new Map((await fetchSeasons(id, seasons, 'en-US').catch(() => [])).map((e) => [e.id, e]))
  }

  const episodes: TvEpisode[] = fr
    .map((e) => {
      const alt = en.get(e.id)
      const name = !untitled(e.name) ? e.name! : !untitled(alt?.name ?? null) ? alt!.name! : `Épisode ${e.episode_number}`
      return {
        id: e.id,
        season: e.season_number,
        number: e.episode_number,
        name,
        airdate: e.air_date ?? '',
        airstamp: null,
        runtime: e.runtime ?? null,
        summary: e.overview || alt?.overview || null,
        image: e.still_path ? { medium: `${IMG}w300${e.still_path}`, original: `${IMG}w780${e.still_path}` } : null,
      }
    })
    .sort((a, b) => a.season - b.season || a.number - b.number)

  const show = toShow({ ...raw, overview: raw.overview || enShow?.overview || null })
  const data = { show, episodes }
  const c = { at: Date.now(), data }
  memory.set(id, c)
  void idbSet(cacheKey(id), c)
  return data
}

/**
 * Fiche et épisodes d'une série, en cache 12 h (IndexedDB). `force` ignore le
 * cache. Si le réseau échoue, une fiche périmée vaut mieux que rien : on la renvoie.
 */
export async function getShowWithEpisodes(id: number, force = false): Promise<ShowWithEpisodes> {
  const cached = force ? undefined : (await peekShows([id])).get(id)
  if (cached && isFresh(cached)) return cached.data

  const pending = inflight.get(id)
  if (pending && !force) return pending

  const p = fetchShow(id)
    .catch((e) => {
      if (cached) return cached.data
      throw e
    })
    .finally(() => inflight.delete(id))
  inflight.set(id, p)
  return p
}

export function stripHtml(html: string | null): string {
  if (!html) return ''
  return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? ''
}

const STATUS_FR: Record<string, string> = {
  Running: 'En cours de diffusion',
  Ended: 'Terminée',
  'In Development': 'En développement',
}
export const statusFr = (s: string) => STATUS_FR[s] ?? s
