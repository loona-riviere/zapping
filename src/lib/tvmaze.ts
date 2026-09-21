// Client minimal pour l'API publique TVmaze (sans clé, CORS ouvert).
// Doc : https://www.tvmaze.com/api

export type TvShow = {
  id: number
  name: string
  image: { medium: string; original: string } | null
  premiered: string | null
  status: string
  summary: string | null
  genres: string[]
  network: { name: string } | null
  webChannel: { name: string } | null
}

export type TvEpisode = {
  id: number
  season: number
  number: number
  name: string
  airdate: string
  airstamp: string | null
  runtime: number | null
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

export async function searchShows(query: string): Promise<TvShow[]> {
  const data = await get<{ show: TvShow }[]>(`/search/shows?q=${encodeURIComponent(query)}`)
  return data.map((d) => d.show)
}

export function getShowWithEpisodes(id: number): Promise<ShowWithEpisodes> {
  const key = `tvmaze:show:${id}`
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const cached = JSON.parse(raw) as { at: number; data: ShowWithEpisodes }
      if (Date.now() - cached.at < CACHE_TTL) return Promise.resolve(cached.data)
    }
  } catch {
    /* cache illisible : on refetch */
  }

  const pending = inflight.get(id)
  if (pending) return pending

  const p = get<TvShow & { _embedded: { episodes: (TvEpisode & { number: number | null })[] } }>(
    `/shows/${id}?embed=episodes`,
  )
    .then(({ _embedded, ...show }) => {
      const episodes = _embedded.episodes
        .filter((e): e is TvEpisode => e.number !== null) // on ignore les épisodes spéciaux
        .map(({ id, season, number, name, airdate, airstamp, runtime }) => ({
          id, season, number, name, airdate, airstamp, runtime,
        }))
      const s: TvShow = {
        id: show.id, name: show.name, image: show.image, premiered: show.premiered,
        status: show.status, summary: show.summary, genres: show.genres,
        network: show.network, webChannel: show.webChannel,
      }
      const data = { show: s, episodes }
      try {
        localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }))
      } catch {
        /* stockage plein : pas grave */
      }
      return data
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
