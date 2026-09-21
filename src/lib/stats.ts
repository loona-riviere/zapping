// Calculs de la page Statistiques. Fonctions pures : aucune dépendance au
// réseau ni à React, pour rester vérifiables.

import type { WatchedEpisodes } from './appState'
import type { ShowStatus, TrackedShow, WatchedMovie } from './store'
import type { ShowWithEpisodes } from './tvmaze'

export type ShowTotal = {
  id: number
  name: string
  minutes: number
  episodes: number
  /** Revisionnages complets, au-delà du premier. */
  rewatches: number
}

export type Stats = {
  /** Séries et films confondus. */
  minutes: number
  showMinutes: number
  movieMinutes: number
  /** Épisodes distincts cochés, revisionnages non compris. */
  episodes: number
  /** Épisodes vus au total, revisionnages compris. */
  episodesWithRewatches: number
  /** Séries revues au moins une fois en entier. */
  rewatchedShows: number
  /** Épisodes vus dont TVmaze ignore la durée : exclus du temps total. */
  undatedRuntime: number
  shows: number
  finished: number
  movies: number
  moviesUndated: number
  /** Films dont la durée n'a pas encore été relevée chez TMDB. */
  moviesNoRuntime: number
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

export function computeStats(
  tracked: TrackedShow[],
  watchedFor: (showId: number) => WatchedEpisodes,
  data: Record<number, ShowWithEpisodes>,
  movies: WatchedMovie[],
): Stats {
  let showMinutes = 0
  let episodes = 0
  let episodesWithRewatches = 0
  let rewatchedShows = 0
  let undatedRuntime = 0
  let finished = 0
  let pending = 0
  let firstWatch: string | null = null
  const totals: ShowTotal[] = []

  for (const t of tracked) {
    const show = data[t.show_id]
    if (!show) {
      pending++
      continue
    }
    const seen = watchedFor(t.show_id)
    const fallback = medianRuntime(show)
    let showTotal = 0
    let showEpisodes = 0

    for (const ep of show.episodes) {
      const at = seen.get(ep.id)
      if (at === undefined) continue
      episodes++
      showEpisodes++
      const runtime = typeof ep.runtime === 'number' && ep.runtime > 0 ? ep.runtime : fallback
      if (runtime === null) undatedRuntime++
      else {
        showMinutes += runtime
        showTotal += runtime
      }

      if (at === null) continue
      const day = at.slice(0, 10)
      if (!firstWatch || day < firstWatch) firstWatch = day
    }

    // Revoir une série, c'est y avoir vraiment passé ce temps une fois de plus.
    const passes = 1 + Math.max(0, t.rewatches ?? 0)
    showMinutes += showTotal * (passes - 1)
    episodesWithRewatches += showEpisodes * passes
    if (passes > 1 && showEpisodes) rewatchedShows++

    if (showEpisodes) {
      totals.push({
        id: t.show_id,
        name: show.show.name,
        minutes: showTotal * passes,
        episodes: showEpisodes,
        rewatches: passes - 1,
      })
    }
    const aired = show.episodes.length
    if (aired > 0 && showEpisodes >= aired && show.show.status === 'Ended') finished++
  }

  let movieMinutes = 0
  for (const m of movies) {
    if (m.runtime) movieMinutes += m.runtime
    const day = m.watched_at?.slice(0, 10)
    if (day && (!firstWatch || day < firstWatch)) firstWatch = day
  }

  totals.sort((a, b) => b.minutes - a.minutes || b.episodes - a.episodes)

  return {
    minutes: showMinutes + movieMinutes,
    showMinutes,
    movieMinutes,
    episodes,
    episodesWithRewatches,
    rewatchedShows,
    undatedRuntime,
    shows: tracked.length,
    finished,
    movies: movies.length,
    moviesUndated: movies.filter((m) => !m.watched_at).length,
    moviesNoRuntime: movies.filter((m) => m.runtime == null).length,
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

