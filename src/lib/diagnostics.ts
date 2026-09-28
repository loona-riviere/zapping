// Détecte deux bugs déjà rencontrés « à la main » cette saison : le tri de
// l'accueil qui se décale de la vraie dernière activité, et un import dont
// les dates d'épisodes ont été mal associées (elles ne progressent plus dans
// l'ordre de diffusion). Fonctions pures, aucun accès réseau : tout part de
// ce que l'app a déjà en mémoire.

import { epCode } from './progress'
import type { TrackedShow } from './store'
import type { ShowWithEpisodes } from './tvmaze'
import type { WatchedEpisodes } from './appState'

function maxDate(m: WatchedEpisodes): string | null {
  let max: string | null = null
  for (const d of m.values()) {
    if (d && (!max || d > max)) max = d
  }
  return max
}

/**
 * La vraie dernière activité : la passe de revisionnage en cours si elle a
 * déjà coché quelque chose, sinon l'historique — exactement le calcul que
 * fait `setWatched` pour fixer `last_watched_at`.
 */
export function computeTrueLastWatched(
  showId: number,
  watchedFor: (id: number) => WatchedEpisodes,
  historyFor: (id: number) => WatchedEpisodes,
): string | null {
  return maxDate(watchedFor(showId)) ?? maxDate(historyFor(showId))
}

export type ActivityIssue = {
  showId: number
  showName: string
  recorded: string | null
  actual: string | null
}

/** Séries dont `last_watched_at` (le tri de l'accueil) ne colle plus aux dates réelles. */
export function findActivityIssues(
  tracked: TrackedShow[],
  watchedFor: (id: number) => WatchedEpisodes,
  historyFor: (id: number) => WatchedEpisodes,
): ActivityIssue[] {
  const issues: ActivityIssue[] = []
  for (const t of tracked) {
    const actual = computeTrueLastWatched(t.show_id, watchedFor, historyFor)
    const recorded = t.last_watched_at ?? null
    if (recorded !== actual) {
      issues.push({ showId: t.show_id, showName: t.name, recorded, actual })
    }
  }
  return issues
}

export type SeasonIssue = {
  showId: number
  showName: string
  season: number
  /** Un épisode vu après un épisode qui le suit à l'écran — signe d'un mauvais import. */
  before: { code: string; date: string }
  after: { code: string; date: string }
}

/**
 * Repère les saisons où les dates de visionnage ne progressent pas avec le
 * numéro d'épisode. Un revisionnage désordonné explique parfois un aller-
 * retour isolé ; plusieurs dans la même saison sentent plutôt le mauvais
 * import (le bug rencontré sur Friends et Sex/Life). Signalé, jamais corrigé
 * seul : la bonne date se retrouve au cas par cas, pas par une formule.
 */
export function findSeasonIssues(
  tracked: TrackedShow[],
  data: Record<number, ShowWithEpisodes>,
  historyFor: (id: number) => WatchedEpisodes,
): SeasonIssue[] {
  const issues: SeasonIssue[] = []
  for (const t of tracked) {
    const show = data[t.show_id]
    if (!show) continue
    const hist = historyFor(t.show_id)

    const bySeason = new Map<number, typeof show.episodes>()
    for (const ep of show.episodes) {
      const list = bySeason.get(ep.season)
      if (list) list.push(ep)
      else bySeason.set(ep.season, [ep])
    }

    for (const [season, eps] of bySeason) {
      const seen = eps
        .filter((e) => hist.get(e.id))
        .sort((a, b) => a.number - b.number)
      for (let i = 1; i < seen.length; i++) {
        const prev = seen[i - 1]
        const cur = seen[i]
        const prevDate = hist.get(prev.id)!
        const curDate = hist.get(cur.id)!
        if (prevDate.slice(0, 10) > curDate.slice(0, 10)) {
          issues.push({
            showId: t.show_id,
            showName: show.show.name,
            season,
            before: { code: epCode(prev), date: prevDate },
            after: { code: epCode(cur), date: curDate },
          })
        }
      }
    }
  }
  return issues
}
