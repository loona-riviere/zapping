// Ce que mes amis ont fait d'un titre : vu, en cours, prévu, et leur note.
// Les règles de la base ne renvoient que les amis, et rien de ce qu'ils cachent.

import type { Rating } from './store'
import { supabase } from './supabase'

export type FriendOn = {
  userId: string
  /** « vu », « en cours », « à voir »… déjà formulé pour l'affichage. */
  state: 'done' | 'doing' | 'later' | 'dropped'
  detail: string
  rating: Rating | null
}

const d = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : null

export async function friendsOnShow(showId: number, friendIds: string[], aired: number): Promise<FriendOn[]> {
  if (!friendIds.length) return []
  const [{ data: shows }, { data: eps }] = await Promise.all([
    supabase.from('tracked_shows').select('user_id, status, rating, rewatches').eq('show_id', showId).in('user_id', friendIds),
    supabase.from('watched_episodes').select('user_id').eq('show_id', showId).in('user_id', friendIds),
  ])
  const count = new Map<string, number>()
  for (const e of eps ?? []) count.set(e.user_id, (count.get(e.user_id) ?? 0) + 1)
  return (shows ?? []).map((s) => {
    const n = count.get(s.user_id) ?? 0
    const all = aired > 0 && n >= aired
    const times = (s.rewatches ?? 0) + 1
    const state: FriendOn['state'] =
      s.status === 'dropped' ? 'dropped' : all ? 'done' : n > 0 ? 'doing' : s.status === 'later' ? 'later' : 'doing'
    const detail =
      state === 'done'
        ? times > 1 ? `vue ${times} fois` : 'vue en entier'
        : state === 'dropped'
          ? `abandonnée${n ? ` après ${n} ép.` : ''}`
          : state === 'later'
            ? 'dans sa liste à voir'
            : `${n}${aired ? ` / ${aired}` : ''} ép. vus`
    return { userId: s.user_id, state, detail, rating: (s.rating ?? null) as Rating | null }
  })
}

export async function friendsOnMovie(movieId: number, friendIds: string[]): Promise<FriendOn[]> {
  if (!friendIds.length) return []
  const { data } = await supabase
    .from('watched_movies')
    .select('user_id, status, rating, watched_at, past_views')
    .eq('movie_id', movieId)
    .in('user_id', friendIds)
  return (data ?? []).map((m) => {
    const times = 1 + ((m.past_views as unknown[] | null)?.length ?? 0)
    return m.status === 'watched'
      ? {
          userId: m.user_id,
          state: 'done' as const,
          detail: [times > 1 ? `vu ${times} fois` : 'vu', d(m.watched_at) ? `le ${d(m.watched_at)}` : null].filter(Boolean).join(' '),
          rating: (m.rating ?? null) as Rating | null,
        }
      : { userId: m.user_id, state: 'later' as const, detail: 'dans sa liste à voir', rating: null }
  })
}

export async function friendsOnBook(bookId: string, friendIds: string[]): Promise<FriendOn[]> {
  if (!friendIds.length) return []
  const { data } = await supabase
    .from('tracked_books')
    .select('user_id, status, rating, finished_at, current_page, page_count')
    .eq('book_id', bookId)
    .in('user_id', friendIds)
  return (data ?? []).map((b) => {
    const state: FriendOn['state'] =
      b.status === 'read' ? 'done' : b.status === 'reading' ? 'doing' : b.status === 'dropped' ? 'dropped' : 'later'
    const detail =
      state === 'done'
        ? `lu${d(b.finished_at) ? ` le ${d(b.finished_at)}` : ''}`
        : state === 'doing'
          ? b.page_count ? `en cours, page ${b.current_page} / ${b.page_count}` : 'en cours'
          : state === 'dropped'
            ? 'abandonné'
            : 'dans sa pile à lire'
    return { userId: b.user_id, state, detail, rating: (b.rating ?? null) as Rating | null }
  })
}
