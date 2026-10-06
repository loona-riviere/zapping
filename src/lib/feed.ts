// Fil d'activité des amis : ce qu'ils ont regardé et lu ces dernières
// semaines, reconstitué à partir de leurs bibliothèques. Rien de plus à
// stocker : les règles d'accès (supabase/schema.sql) ne renvoient déjà que
// les amis, et rien de ce qu'ils cachent.

import type { Rating } from './store'
import { supabase } from './supabase'

export type FeedItem = {
  key: string
  userId: string
  /** Instant de l'activité (le plus récent pour un groupe d'épisodes). */
  at: string
  kind: 'show' | 'movie' | 'book'
  itemId: number | string
  title: string
  image: string | null
  /** « a vu 3 épisodes de », « a fini »… déjà formulé pour l'affichage. */
  verb: string
  detail: string | null
  rating: Rating | null
}

const DAYS = 30
const pad = (n: number) => String(n).padStart(2, '0')
const code = (s: number, e: number) => `S${pad(s)}E${pad(e)}`

/** Jour local d'un instant : les épisodes d'une même soirée vont ensemble. */
function localDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export async function fetchFeed(friendIds: string[]): Promise<FeedItem[]> {
  if (!friendIds.length) return []
  const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000).toISOString()
  const [eps, shows, movies, books] = await Promise.all([
    supabase
      .from('watched_episodes')
      .select('user_id, show_id, season, number, watched_at')
      .in('user_id', friendIds)
      .gte('watched_at', since)
      .order('watched_at', { ascending: false })
      .limit(1500),
    supabase.from('tracked_shows').select('user_id, show_id, name, image_url, rating').in('user_id', friendIds),
    supabase
      .from('watched_movies')
      .select('user_id, movie_id, title, poster_url, watched_at, rating, past_views')
      .in('user_id', friendIds)
      .eq('status', 'watched')
      .gte('watched_at', since),
    supabase
      .from('tracked_books')
      .select('user_id, book_id, title, cover_url, status, started_at, finished_at, rating')
      .in('user_id', friendIds)
      .or(`finished_at.gte."${since}",started_at.gte."${since}"`),
  ])
  if (eps.error) throw eps.error
  if (shows.error) throw shows.error
  if (movies.error) throw movies.error

  const items: FeedItem[] = []

  // Épisodes : un groupe par ami, série et jour (« a vu 3 épisodes de… »).
  const showOf = new Map((shows.data ?? []).map((s) => [`${s.user_id}:${s.show_id}`, s]))
  type Ep = { season: number; number: number; at: string }
  const groups = new Map<string, { userId: string; showId: number; eps: Ep[] }>()
  for (const e of eps.data ?? []) {
    if (!e.watched_at) continue
    const k = `${e.user_id}:${e.show_id}:${localDay(e.watched_at)}`
    const g = groups.get(k) ?? { userId: e.user_id as string, showId: e.show_id as number, eps: [] as Ep[] }
    g.eps.push({ season: e.season, number: e.number, at: e.watched_at })
    groups.set(k, g)
  }
  for (const [k, g] of groups) {
    const show = showOf.get(`${g.userId}:${g.showId}`)
    if (!show) continue
    g.eps.sort((a, b) => a.season - b.season || a.number - b.number)
    const first = g.eps[0]
    const last = g.eps[g.eps.length - 1]
    const n = g.eps.length
    items.push({
      key: `e${k}`,
      userId: g.userId,
      at: g.eps.reduce((m, e) => (e.at > m ? e.at : m), first.at),
      kind: 'show',
      itemId: g.showId,
      title: show.name,
      image: show.image_url,
      verb: n === 1 ? 'a vu un épisode de' : `a vu ${n} épisodes de`,
      detail: n === 1 ? code(first.season, first.number) : first.season === last.season ? `${code(first.season, first.number)} → E${pad(last.number)}` : `${code(first.season, first.number)} → ${code(last.season, last.number)}`,
      rating: null,
    })
  }

  for (const m of movies.data ?? []) {
    const again = ((m.past_views as unknown[] | null)?.length ?? 0) > 0
    items.push({
      key: `m${m.user_id}:${m.movie_id}`,
      userId: m.user_id,
      at: m.watched_at!,
      kind: 'movie',
      itemId: m.movie_id,
      title: m.title,
      image: m.poster_url,
      verb: again ? 'a revu' : 'a vu',
      detail: null,
      rating: (m.rating ?? null) as Rating | null,
    })
  }

  // Livres : une table pas encore installée chez l'ami ne casse pas tout le fil.
  for (const b of books.error ? [] : (books.data ?? [])) {
    if (b.status === 'read' && b.finished_at && b.finished_at >= since) {
      items.push({
        key: `bf${b.user_id}:${b.book_id}`,
        userId: b.user_id, at: b.finished_at, kind: 'book', itemId: b.book_id,
        title: b.title, image: b.cover_url, verb: 'a fini', detail: null,
        rating: (b.rating ?? null) as Rating | null,
      })
    } else if (b.status === 'reading' && b.started_at && b.started_at >= since) {
      items.push({
        key: `bs${b.user_id}:${b.book_id}`,
        userId: b.user_id, at: b.started_at, kind: 'book', itemId: b.book_id,
        title: b.title, image: b.cover_url, verb: 'a commencé', detail: null, rating: null,
      })
    }
  }

  return items.sort((a, b) => b.at.localeCompare(a.at))
}

/** « aujourd'hui », « hier », « lundi », puis « 3 oct. ». */
export function whenLabel(iso: string, now = new Date()): string {
  const day = localDay(iso)
  const today = localDay(now.toISOString())
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString())
  if (day === today) return "aujourd'hui"
  if (day === yesterday) return 'hier'
  const d = new Date(iso)
  if (now.getTime() - d.getTime() < 6 * 24 * 3600 * 1000) return d.toLocaleDateString('fr-FR', { weekday: 'long' })
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}
