// Client minimal pour l'API publique TVmaze (sans clé, CORS ouvert).
// Doc : https://www.tvmaze.com/api

import { idbGetMany, idbSet } from './idb'

export type TvShow = {
  id: number
  name: string
  image: { medium: string; original: string } | null
  premiered: string | null
  status: string
  summary: string | null
  genres: string[]
  /** Note moyenne de la communauté TVmaze, sur 10 — absente pour une série trop récente. */
  rating: number | null
  network: { name: string } | null
  webChannel: { name: string } | null
  /** Identifiants externes : l'IMDb sert de pont vers TMDB. */
  externals: { imdb: string | null } | null
}

export type TvEpisode = {
  id: number
  season: number
  number: number
  name: string
  airdate: string
  airstamp: string | null
  runtime: number | null
  summary: string | null
}

export type ShowWithEpisodes = { show: TvShow; episodes: TvEpisode[] }

const BASE = 'https://api.tvmaze.com'
const CACHE_TTL = 12 * 60 * 60 * 1000 // 12 h
const inflight = new Map<number, Promise<ShowWithEpisodes>>()

async function get<T>(path: string, retry = true): Promise<T> {
  const res = await fetch(BASE + path)
  // TVmaze limite à ~20 requêtes / 10 s : on patiente puis on réessaie une fois.
  if (res.status === 429 && retry) {
    await new Promise((r) => setTimeout(r, 2500))
    return get<T>(path, false)
  }
  if (!res.ok) throw new Error(`TVmaze a répondu ${res.status}`)
  return res.json() as Promise<T>
}

type RawTvShow = Omit<TvShow, 'rating'> & { rating: { average: number | null } | null }

export async function searchShows(query: string): Promise<TvShow[]> {
  const data = await get<{ show: RawTvShow }[]>(`/search/shows?q=${encodeURIComponent(query)}`)
  return data.map((d) => ({ ...d.show, rating: d.show.rating?.average ?? null }))
}

type Cached = { at: number; data: ShowWithEpisodes }

// v2 : même forme qu'avant (voir le numéro dans l'ancienne clé localStorage),
// désormais rangée dans IndexedDB.
const cacheKey = (id: number) => `tvmaze:show:v2:${id}`
const memory = new Map<number, Cached>()

/**
 * Fiches déjà en cache, quel que soit leur âge — pour afficher tout de suite
 * la bibliothèque d'un seul bloc, puis rafraîchir en arrière-plan ce qui est
 * périmé. Au passage, déménage vers IndexedDB les fiches encore rangées dans
 * le localStorage par les versions précédentes (et libère ce dernier).
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
    let c = stored.get(cacheKey(id))
    if (!c) {
      try {
        const raw = localStorage.getItem(cacheKey(id))
        if (raw) {
          c = JSON.parse(raw) as Cached
          void idbSet(cacheKey(id), c)
          localStorage.removeItem(cacheKey(id))
        }
      } catch {
        /* ancien cache illisible : la fiche sera rechargée */
      }
    }
    if (c) {
      memory.set(id, c)
      out.set(id, c)
    }
  }
  return out
}

export const isFresh = (c: Cached) => Date.now() - c.at < CACHE_TTL

async function fetchShow(id: number): Promise<ShowWithEpisodes> {
  const { _embedded, ...show } = await get<
    RawTvShow & { _embedded: { episodes: (TvEpisode & { number: number | null })[] } }
  >(`/shows/${id}?embed=episodes`)
  const episodes = _embedded.episodes
    .filter((e): e is TvEpisode => e.number !== null) // on ignore les épisodes spéciaux
    .map(({ id, season, number, name, airdate, airstamp, runtime, summary }) => ({
      id, season, number, name, airdate, airstamp, runtime, summary: summary ?? null,
    }))
  const s: TvShow = {
    id: show.id, name: show.name, image: show.image, premiered: show.premiered,
    status: show.status, summary: show.summary, genres: show.genres,
    rating: show.rating?.average ?? null,
    network: show.network, webChannel: show.webChannel,
    externals: show.externals ?? null,
  }
  const data = { show: s, episodes }
  const c = { at: Date.now(), data }
  memory.set(id, c)
  void idbSet(cacheKey(id), c)
  return data
}

/**
 * Fiche et épisodes d'une série, en cache 12 h (IndexedDB). `force` ignore le
 * cache : c'est la sortie de secours quand TVmaze a été complété entre-temps
 * (une saison ajoutée, par exemple). Si le réseau échoue, une fiche périmée
 * vaut mieux que rien : on la renvoie.
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
  'To Be Determined': 'Suite incertaine',
  'In Development': 'En développement',
}
export const statusFr = (s: string) => STATUS_FR[s] ?? s
