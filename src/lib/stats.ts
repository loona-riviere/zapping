// Calculs de la page Statistiques. Fonctions pures : aucune dépendance au
// réseau ni à React, pour rester vérifiables.

import type { WatchedEpisodes } from './appState'
import type { ShowStatus, TrackedShow, WatchedMovie } from './store'
import type { ShowWithEpisodes } from './tvmaze'

export type MonthPoint = { month: string; minutes: number; episodes: number }
export type ShowTotal = { id: number; name: string; minutes: number; episodes: number }

export type Stats = {
  minutes: number
  episodes: number
  /** Épisodes vus dont TVmaze ignore la durée : exclus du temps total. */
  undatedRuntime: number
  /** Épisodes vus sans date connue : comptés au total, absents de la courbe. */
  undated: number
  shows: number
  finished: number
  movies: number
  moviesUndated: number
  byMonth: MonthPoint[]
  topShows: ShowTotal[]
  firstWatch: string | null
  /** Séries suivies dont les épisodes ne sont pas encore chargés. */
  pending: number
}

/** Durée de référence d'une série : la médiane de ses épisodes renseignés. */
function medianRuntime(data: ShowWithEpisodes): number | null {
  const values = data.episodes
    .map((e) => e.runtime)
    .filter((r): r is number => typeof r === 'number' && r > 0)
    .sort((a, b) => a - b)
  if (!values.length) return null
  return values[Math.floor(values.length / 2)]
}

/**
 * Comble les mois sans visionnage : un histogramme temporel qui saute les mois
 * vides écrase les pauses et fait mentir la forme.
 */
function fillMonths(points: Map<string, MonthPoint>): MonthPoint[] {
  const keys = [...points.keys()].sort()
  if (!keys.length) return []
  const out: MonthPoint[] = []
  const [startY, startM] = keys[0].split('-').map(Number)
  const [endY, endM] = keys[keys.length - 1].split('-').map(Number)
  for (let y = startY, m = startM; y < endY || (y === endY && m <= endM); ) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    out.push(points.get(key) ?? { month: key, minutes: 0, episodes: 0 })
    m === 12 ? ((y += 1), (m = 1)) : (m += 1)
  }
  return out
}

export function computeStats(
  tracked: TrackedShow[],
  watchedFor: (showId: number) => WatchedEpisodes,
  data: Record<number, ShowWithEpisodes>,
  movies: WatchedMovie[],
): Stats {
  let minutes = 0
  let episodes = 0
  let undatedRuntime = 0
  let undated = 0
  let finished = 0
  let pending = 0
  let firstWatch: string | null = null
  const months = new Map<string, MonthPoint>()
  const totals: ShowTotal[] = []

  for (const t of tracked) {
    const show = data[t.show_id]
    if (!show) {
      pending++
      continue
    }
    const seen = watchedFor(t.show_id)
    const fallback = medianRuntime(show)
    let showMinutes = 0
    let showEpisodes = 0

    for (const ep of show.episodes) {
      const at = seen.get(ep.id)
      if (at === undefined) continue
      episodes++
      showEpisodes++
      const runtime = typeof ep.runtime === 'number' && ep.runtime > 0 ? ep.runtime : fallback
      if (runtime === null) undatedRuntime++
      else {
        minutes += runtime
        showMinutes += runtime
      }

      // Sans date, l'épisode compte dans les totaux mais pas dans l'activité :
      // le placer arbitrairement dans un mois inventerait un pic.
      if (at === null) {
        undated++
        continue
      }

      const day = at.slice(0, 10)
      if (!firstWatch || day < firstWatch) firstWatch = day
      const key = at.slice(0, 7)
      const point = months.get(key) ?? { month: key, minutes: 0, episodes: 0 }
      point.minutes += runtime ?? 0
      point.episodes += 1
      months.set(key, point)
    }

    if (showEpisodes) totals.push({ id: t.show_id, name: show.show.name, minutes: showMinutes, episodes: showEpisodes })
    const aired = show.episodes.length
    if (aired > 0 && showEpisodes >= aired && show.show.status === 'Ended') finished++
  }

  totals.sort((a, b) => b.minutes - a.minutes || b.episodes - a.episodes)

  return {
    minutes,
    episodes,
    undatedRuntime,
    undated,
    shows: tracked.length,
    finished,
    movies: movies.length,
    moviesUndated: movies.filter((m) => !m.watched_at).length,
    byMonth: fillMonths(months),
    topShows: totals.slice(0, 8),
    firstWatch,
    pending,
  }
}

/** Compte les séries par statut, pour la répartition affichée sous les compteurs. */
export function countByStatus(tracked: TrackedShow[]): Record<ShowStatus, number> {
  const out = { watching: 0, paused: 0, later: 0, dropped: 0 }
  for (const t of tracked) out[t.status] += 1
  return out
}

/* ------------------------------------------------------------------ format -- */

/** « 47 jours », « 14 h », « 35 min » : l'unité la plus parlante, pas la plus précise. */
export function humanDuration(minutes: number): { value: string; unit: string } {
  if (minutes < 90) return { value: String(Math.round(minutes)), unit: minutes > 1 ? 'minutes' : 'minute' }
  const hours = minutes / 60
  if (hours < 48) return { value: hours.toFixed(hours < 10 ? 1 : 0).replace('.', ','), unit: 'heures' }
  const days = hours / 24
  return { value: days.toFixed(days < 10 ? 1 : 0).replace('.', ','), unit: days >= 2 ? 'jours' : 'jour' }
}

export const formatNumber = (n: number) => n.toLocaleString('fr-FR')

/** Abrégé de l'unité rendue par humanDuration : « min », « h » ou « j ». */
export function shortUnit(unit: string): string {
  if (unit.startsWith('min')) return 'min'
  if (unit.startsWith('heure')) return 'h'
  return 'j'
}

/** « 2026-09 » → « sept. 2026 ». */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export const shortMonth = (key: string) => monthLabel(key).replace(/\s?\d{4}$/, '')
export const yearOf = (key: string) => key.slice(0, 4)
