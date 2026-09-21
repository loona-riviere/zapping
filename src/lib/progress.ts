import type { WatchedEpisodes } from './appState'
import type { TvEpisode } from './tvmaze'

export function isAired(ep: TvEpisode, now = Date.now()): boolean {
  if (!ep.airdate) return false
  const t = ep.airstamp ? Date.parse(ep.airstamp) : Date.parse(ep.airdate)
  return !Number.isNaN(t) && t <= now
}

export type Progress = {
  aired: number
  watched: number
  next: TvEpisode | null      // premier épisode diffusé et non vu
  upcoming: TvEpisode | null  // prochain épisode pas encore diffusé
}

export function computeProgress(episodes: TvEpisode[], watched: WatchedEpisodes): Progress {
  let aired = 0
  let seen = 0
  let next: TvEpisode | null = null
  let upcoming: TvEpisode | null = null
  for (const ep of episodes) {
    if (isAired(ep)) {
      aired++
      if (watched.has(ep.id)) seen++
      else if (!next) next = ep
    } else if (!upcoming) {
      upcoming = ep
    }
  }
  return { aired, watched: seen, next, upcoming }
}

const pad = (n: number) => String(n).padStart(2, '0')
export const epCode = (ep: TvEpisode) => `S${pad(ep.season)}E${pad(ep.number)}`

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Date courte, pour les listes denses : « 21 sept. 2026 ». */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}
