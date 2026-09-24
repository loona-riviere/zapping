import type { Book } from './books'
import { guessGenre } from './genres'
import type { Rating } from './store'
import { isMissingSchema } from './store'
import { supabase } from './supabase'

/** Où en est un livre : en cours, lu, à lire, abandonné. */
export type BookStatus = 'reading' | 'read' | 'later' | 'dropped'

export const BOOK_STATUS_LABEL: Record<BookStatus, string> = {
  reading: 'En cours',
  read: 'Lu',
  later: 'À lire',
  dropped: 'Abandonné',
}

export const BOOK_STATUSES = Object.keys(BOOK_STATUS_LABEL) as BookStatus[]

export type TrackedBook = {
  book_id: string
  title: string
  /** Auteurs séparés par des virgules : on ne fait que les afficher. */
  authors: string | null
  cover_url: string | null
  page_count: number | null
  published_year: number | null
  status: BookStatus
  current_page: number
  /** Null quand la date est inconnue — mieux qu'une date inventée. */
  started_at: string | null
  finished_at: string | null
  rating: Rating | null
  added_at: string
  /** Dernière activité (page avancée, statut changé) : sert au tri des livres en cours. */
  updated_at: string
  /** Rang dans « à lire », plus petit = plus envie ; absent = pas rangé. */
  wish_rank?: number | null
  /** Genre en français (lib/genres), deviné à l'ajout, corrigeable ; absent si inconnu. */
  genre?: string | null
}

/** Colonnes modifiables après coup depuis l'app. */
export type BookPatch = Partial<
  Pick<TrackedBook, 'status' | 'current_page' | 'started_at' | 'finished_at' | 'rating' | 'page_count' | 'cover_url' | 'genre'>
>

const PAGE = 1000

export async function fetchBooks(): Promise<TrackedBook[]> {
  const out: TrackedBook[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('tracked_books')
      // `*` : une colonne ajoutée depuis (genre, wish_rank) qui manquerait
      // encore en base est juste absente des lignes, sans faire échouer la lecture.
      .select('*')
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...((data ?? []) as TrackedBook[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

/** La ligne telle qu'elle sera en base, construite une fois pour l'état local et pour Supabase. */
export function bookRow(book: Book, status: BookStatus, at: { started_at?: string | null; finished_at?: string | null } = {}): TrackedBook {
  const now = new Date().toISOString()
  return {
    book_id: book.id,
    title: book.title,
    authors: book.authors.length ? book.authors.join(', ') : null,
    cover_url: book.cover_url,
    page_count: book.page_count,
    published_year: book.year,
    status,
    current_page: status === 'read' && book.page_count ? book.page_count : 0,
    started_at: at.started_at ?? (status === 'reading' ? now : null),
    finished_at: at.finished_at ?? null,
    rating: null,
    added_at: now,
    updated_at: now,
    genre: guessGenre(book.categories),
  }
}

export async function insertBook(userId: string, row: TrackedBook): Promise<void> {
  // Colonnes vides non envoyées : elles peuvent manquer si le schéma n'a pas été relancé.
  const { wish_rank, genre, ...base } = row
  const full = { ...base, ...(wish_rank != null ? { wish_rank } : {}), ...(genre ? { genre } : {}), user_id: userId }
  const opts = { onConflict: 'user_id,book_id', ignoreDuplicates: true }
  const { error } = await supabase.from('tracked_books').upsert(full, opts)
  if (!error) return
  if (!isMissingSchema(error)) throw error
  // Colonne genre ou wish_rank absente : on enregistre le livre sans elles.
  const retry = await supabase.from('tracked_books').upsert({ ...base, user_id: userId }, opts)
  if (retry.error) throw retry.error
}

export async function updateBook(bookId: string, patch: BookPatch & { updated_at: string }): Promise<void> {
  const { error } = await supabase.from('tracked_books').update(patch).eq('book_id', bookId)
  if (error) throw error
}

export async function deleteBook(bookId: string): Promise<void> {
  const { error } = await supabase.from('tracked_books').delete().eq('book_id', bookId)
  if (error) throw error
}
