import { useShows } from '../lib/showsState'
import { formatShortDate } from '../lib/progress'
import type { TvEpisode } from '../lib/tvmaze'
import { History, type HistoryEntry } from './History'
import { useWithLabel } from './WithPicker'

/**
 * Toutes les fois où cet épisode a été vu. Le premier visionnage et le
 * revisionnage en cours ont la date exacte de l'épisode ; un revisionnage
 * terminé n'a gardé que ses dates de début et de fin : l'épisode a été revu
 * entre les deux. Les dates se corrigent sur la fiche de la série.
 */
export function EpisodeViewings({ showId, ep }: { showId: number; ep: TvEpisode }) {
  const { tracked, watchedFor, historyFor, isRewatching, rewatchesOf } = useShows()
  const withLabel = useWithLabel()
  const row = tracked.find((t) => t.show_id === showId)
  const running = isRewatching(showId)
  const first = historyFor(showId).get(ep.id)
  const again = running ? watchedFor(showId).get(ep.id) : undefined
  const past = (row?.past_viewings ?? []).filter((v) => !ep.airdate || !v.finished_at || v.finished_at.slice(0, 10) >= ep.airdate)
  const undated = Math.max(0, rewatchesOf(showId) - (row?.past_viewings?.length ?? 0))

  const dated: (HistoryEntry & { at: string })[] = past.map((v, i) => {
    const d = (x: string) => formatShortDate(x)
    const text =
      v.started_at && v.finished_at && v.started_at.slice(0, 10) !== v.finished_at.slice(0, 10)
        ? `Vu entre le ${d(v.started_at)} et le ${d(v.finished_at)}`
        : v.finished_at || v.started_at
          ? `Vu vers le ${d((v.finished_at ?? v.started_at)!)}`
          : 'Vu, date inconnue'
    return { at: v.finished_at ?? v.started_at ?? '', key: `past-${i}`, icon: '✓', text, with: withLabel(v.with) }
  })
  if (first !== undefined) {
    dated.push({
      at: first ?? '',
      key: 'first',
      icon: '✓',
      text: first ? `Vu le ${formatShortDate(first)}` : 'Vu, date inconnue',
      with: withLabel(row?.first_with),
    })
  }
  dated.sort((a, b) => b.at.localeCompare(a.at))
  const entries: HistoryEntry[] = []
  if (again !== undefined) {
    entries.push({ key: 'again', icon: '🔁', text: again ? `Revu le ${formatShortDate(again)}` : 'Revu, date inconnue' })
  }
  entries.push(...dated)
  if (undated > 0 && entries.length) {
    entries.push({
      key: 'undated',
      icon: '✓',
      text: undated > 1 ? `Vu ${undated} autres fois, dates inconnues` : 'Vu une autre fois, date inconnue',
    })
  }
  if (entries.length < 2) return null
  const total = entries.reduce((n, e) => n + (e.key === 'undated' ? undated : 1), 0)
  return <History title="Visionnages" summary={`Vu ${total} fois`} entries={entries} editing={false} />
}
