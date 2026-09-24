// Sauvegarde JSON de tout l'historique de visionnage : séries suivies,
// épisodes vus (historique complet + revisionnage en cours), films, livres. Un filet
// de sécurité après tant de corrections manuelles cette saison — une photo
// lisible de l'état actuel, pas un format pensé pour être ré-importé.

import { epCode } from './progress'
import type { TrackedBook } from './bookStore'
import type { TrackedShow, WatchedMovie } from './store'
import type { ShowWithEpisodes } from './tvmaze'
import type { WatchedEpisodes } from './appState'

export type BackupEpisode = {
  id: number
  code: string | null
  name: string | null
  watchedAt: string | null
}

export type BackupShow = {
  showId: number
  name: string
  status: string
  addedAt: string
  lastWatchedAt: string | null
  rewatches: number
  rewatching: boolean
  episodes: BackupEpisode[]
  /** Épisodes déjà cochés dans le revisionnage en cours, absent sinon. */
  currentRewatch?: BackupEpisode[]
}

export type Backup = {
  exportedAt: string
  shows: BackupShow[]
  movies: WatchedMovie[]
  books: TrackedBook[]
}

function toBackupEpisodes(hist: WatchedEpisodes, show?: ShowWithEpisodes): BackupEpisode[] {
  const byId = new Map(show?.episodes.map((e) => [e.id, e]))
  return [...hist.entries()]
    .map(([id, watchedAt]) => {
      const ep = byId.get(id)
      return { id, code: ep ? epCode(ep) : null, name: ep?.name ?? null, watchedAt }
    })
    .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '') || a.id - b.id)
}

export function buildBackup(
  tracked: TrackedShow[],
  historyFor: (id: number) => WatchedEpisodes,
  watchedFor: (id: number) => WatchedEpisodes,
  isRewatching: (id: number) => boolean,
  data: Record<number, ShowWithEpisodes>,
  movies: WatchedMovie[],
  books: TrackedBook[],
): Backup {
  const shows: BackupShow[] = tracked.map((t) => {
    const show = data[t.show_id]
    const rewatching = isRewatching(t.show_id)
    return {
      showId: t.show_id,
      name: show?.show.name ?? t.name,
      status: t.status,
      addedAt: t.added_at,
      lastWatchedAt: t.last_watched_at,
      rewatches: t.rewatches,
      rewatching,
      episodes: toBackupEpisodes(historyFor(t.show_id), show),
      ...(rewatching ? { currentRewatch: toBackupEpisodes(watchedFor(t.show_id), show) } : {}),
    }
  })
  return { exportedAt: new Date().toISOString(), shows, movies, books }
}

/** Déclenche le téléchargement du fichier JSON côté client, sans passer par un serveur. */
export function downloadBackup(backup: Backup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `zapping-sauvegarde-${backup.exportedAt.slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
