// « Ce jour-là » : ce qui a été vu un même jour du calendrier, les années
// précédentes. Fonction pure, aucun accès réseau : part de ce que l'app a
// déjà en mémoire (comme diagnostics.ts et stats.ts).

import { epCode } from './progress'
import type { WatchedEpisodes } from './appState'
import type { TrackedShow, WatchedMovie } from './store'
import type { ShowWithEpisodes } from './tvmaze'

export type OnThisDayEntry = {
  key: string
  kind: 'episode' | 'movie'
  /** show_id pour un épisode, movie_id pour un film. */
  id: number
  title: string
  subtitle: string | null
  image: string | null
  year: number
  yearsAgo: number
}

const monthDay = (iso: string) => iso.slice(5, 10) // « MM-JJ »

export function findOnThisDay(
  tracked: TrackedShow[],
  historyFor: (showId: number) => WatchedEpisodes,
  data: Record<number, ShowWithEpisodes>,
  movies: WatchedMovie[],
  today = new Date(),
): OnThisDayEntry[] {
  const todayKey = monthDay(today.toISOString())
  const thisYear = today.getFullYear()
  const out: OnThisDayEntry[] = []

  for (const t of tracked) {
    const show = data[t.show_id]
    if (!show) continue
    const hist = historyFor(t.show_id)
    for (const ep of show.episodes) {
      const at = hist.get(ep.id)
      if (!at || monthDay(at) !== todayKey) continue
      const year = Number(at.slice(0, 4))
      if (year === thisYear) continue
      out.push({
        key: `ep-${ep.id}`,
        kind: 'episode',
        id: t.show_id,
        title: show.show.name,
        subtitle: `${epCode(ep)} — ${ep.name}`,
        image: show.show.image?.medium ?? null,
        year,
        yearsAgo: thisYear - year,
      })
    }
  }

  for (const m of movies) {
    if (!m.watched_at || monthDay(m.watched_at) !== todayKey) continue
    const year = Number(m.watched_at.slice(0, 4))
    if (year === thisYear) continue
    out.push({
      key: `movie-${m.movie_id}`,
      kind: 'movie',
      id: m.movie_id,
      title: m.title,
      subtitle: null,
      image: m.poster_url,
      year,
      yearsAgo: thisYear - year,
    })
  }

  return out.sort((a, b) => b.year - a.year)
}
