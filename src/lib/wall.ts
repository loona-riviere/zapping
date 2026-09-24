import type { TrackedBook } from './bookStore'
import type { TrackedShow, WatchedMovie } from './store'

// Affiches de ses séries, films et livres préférés, gardées sur l'appareil pour que
// le mur de l'écran de lancement s'affiche tout de suite, sans attendre le
// chargement de la bibliothèque. Clé hors des préfixes de cache vidés quand
// le stockage est plein : quelques Ko à peine.
const KEY = 'zapping:wall:v1'
const MAX = 40

const RANK = { love: 3, like: 2, dislike: -1 } as const

/** Adorés, puis aimés, puis revus, puis les plus récents ; séries, films et livres mélangés. */
export function favoritePosters(tracked: TrackedShow[], movies: WatchedMovie[], books: TrackedBook[] = []): string[] {
  const items = [
    ...tracked
      .filter((t) => t.image_url && t.rating !== 'dislike' && t.last_watched_at)
      .map((t) => ({
        src: t.image_url!,
        score: (t.rating ? RANK[t.rating] : 0) * 10 + (t.rewatches > 0 ? 5 : 0),
        at: t.last_watched_at ?? '',
      })),
    ...movies
      .filter((m) => m.poster_url && m.status === 'watched' && m.rating !== 'dislike')
      .map((m) => ({ src: m.poster_url!, score: (m.rating ? RANK[m.rating] : 0) * 10, at: m.watched_at ?? '' })),
    // Livres lus ou en cours : une pile à lire n'est pas encore un souvenir.
    ...books
      .filter((b) => b.cover_url && (b.status === 'read' || b.status === 'reading') && b.rating !== 'dislike')
      .map((b) => ({
        src: b.cover_url!,
        score: (b.rating ? RANK[b.rating] : 0) * 10,
        at: b.finished_at ?? b.updated_at,
      })),
  ]
  return items
    .sort((a, b) => b.score - a.score || b.at.localeCompare(a.at))
    .slice(0, MAX)
    .map((i) => i.src)
}

export function saveWallPosters(posters: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(posters))
  } catch {
    /* stockage plein : le mur retombera sur les affiches tendance */
  }
}

export function readWallPosters(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}
