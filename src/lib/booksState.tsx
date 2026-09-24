import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Book } from './books'
import * as store from './bookStore'
import type { BookPatch, BookStatus, TrackedBook } from './bookStore'
import { fetchRanks, isMissingSchema, rerank, saveRanks } from './store'
import { celebrate, checkMilestone, nightOwl } from './fun'

type BooksState = {
  books: TrackedBook[]
  /** Faux tant que `supabase/schema.sql` n'a pas été relancé : pas de table livres. */
  booksReady: boolean
  booksLoading: boolean
  bookById: (id: string) => TrackedBook | undefined
  addBook: (book: Book, status: BookStatus, at?: { started_at?: string | null; finished_at?: string | null }) => Promise<void>
  updateBook: (bookId: string, patch: BookPatch) => Promise<void>
  removeBook: (bookId: string) => Promise<void>
  /** Remet un livre tel qu'il était (annulation d'un retrait ou d'un changement). */
  restoreBook: (row: TrackedBook) => Promise<void>
  /** Range « à lire » dans l'ordre d'envie donné (identifiants). */
  reorderBooks: (orderedIds: string[]) => Promise<void>
}

const Ctx = createContext<BooksState | null>(null)

/**
 * Les livres vivent à côté des séries et films, dans leur propre état : leur
 * table peut manquer (schéma pas relancé) sans rien casser du reste, et
 * l'état des séries, déjà chargé, n'a pas à grossir encore.
 */
export function BooksProvider({
  userId,
  onError,
  children,
}: {
  userId: string
  onError: (message: string) => void
  children: ReactNode
}) {
  const [books, setBooks] = useState<TrackedBook[]>([])
  const [booksReady, setBooksReady] = useState(true)
  const [booksLoading, setBooksLoading] = useState(true)

  useEffect(() => {
    let alive = true
    store
      .fetchBooks()
      .then(async (b) => {
        if (!alive) return
        setBooks(b)
        // Rangs lus à part : la colonne peut manquer sans bloquer les livres.
        const ranks = await fetchRanks('tracked_books').catch(() => null)
        if (alive && ranks) setBooks((prev) => prev.map((x) => ({ ...x, wish_rank: ranks.get(x.book_id) ?? null })))
      })
      .catch((e) => {
        if (!alive) return
        if (isMissingSchema(e)) setBooksReady(false)
        else onError(`Chargement des livres impossible : ${e.message}`)
      })
      .finally(() => alive && setBooksLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const bookById = useCallback((id: string) => books.find((b) => b.book_id === id), [books])

  const addBook = useCallback(
    async (book: Book, status: BookStatus, at?: { started_at?: string | null; finished_at?: string | null }) => {
      if (!booksReady) {
        onError('Livres indisponibles : relance supabase/schema.sql dans ton projet Supabase.')
        return
      }
      if (books.some((b) => b.book_id === book.id)) return
      const row = store.bookRow(book, status, at)
      setBooks((prev) => [row, ...prev])
      try {
        await store.insertBook(userId, row)
        if (status === 'read') {
          const n = books.filter((b) => b.status === 'read').length
          checkMilestone('book', n, n + 1)
        }
      } catch (e) {
        setBooks((prev) => prev.filter((b) => b.book_id !== book.id))
        onError(`Ajout du livre impossible : ${(e as Error).message}`)
      }
    },
    [books, booksReady, onError, userId],
  )

  const updateBook = useCallback(
    async (bookId: string, patch: BookPatch) => {
      const before = books.find((b) => b.book_id === bookId)
      if (!before) return
      const full = { ...patch, updated_at: new Date().toISOString() }
      setBooks((prev) => prev.map((b) => (b.book_id === bookId ? { ...b, ...full } : b)))
      try {
        await store.updateBook(bookId, full)
        const finished = patch.status === 'read' && before.status !== 'read'
        if (finished) {
          const n = books.filter((b) => b.status === 'read').length
          checkMilestone('book', n, n + 1)
          // Une vraie lecture qui s'achève, pas un « déjà lu » rangé après coup.
          if (before.status === 'reading') celebrate(`📚 ${before.title} : terminé ! Belle lecture.`)
        }
        if (finished || (patch.current_page !== undefined && patch.current_page !== before.current_page)) nightOwl('book')
      } catch (e) {
        setBooks((prev) => prev.map((b) => (b.book_id === bookId ? before : b)))
        onError(`Enregistrement impossible : ${(e as Error).message}`)
      }
    },
    [books, onError],
  )

  const removeBook = useCallback(
    async (bookId: string) => {
      const snapshot = books
      setBooks((prev) => prev.filter((b) => b.book_id !== bookId))
      try {
        await store.deleteBook(bookId)
      } catch (e) {
        setBooks(snapshot)
        onError(`Suppression impossible : ${(e as Error).message}`)
      }
    },
    [books, onError],
  )

  const restoreBook = useCallback(
    async (row: TrackedBook) => {
      const exists = books.some((b) => b.book_id === row.book_id)
      setBooks((prev) => (exists ? prev.map((b) => (b.book_id === row.book_id ? row : b)) : [row, ...prev]))
      try {
        if (exists) {
          const { status, current_page, started_at, finished_at, rating, updated_at } = row
          await store.updateBook(row.book_id, { status, current_page, started_at, finished_at, rating, updated_at })
        } else {
          await store.insertBook(userId, row)
        }
      } catch (e) {
        onError(`Annulation impossible : ${(e as Error).message}`)
      }
    },
    [books, onError, userId],
  )

  const reorderBooks = useCallback(
    async (orderedIds: string[]) => {
      const byId = new Map(books.map((b) => [b.book_id, b]))
      const ordered = orderedIds.map((id) => byId.get(id)).filter((b): b is TrackedBook => !!b)
      const changes = rerank(ordered, (b) => b.book_id, (b) => b.wish_rank)
      if (!changes.length) return
      const snapshot = books
      const rankOf = new Map(changes.map((c) => [c.id, c.rank]))
      setBooks((prev) => prev.map((b) => (rankOf.has(b.book_id) ? { ...b, wish_rank: rankOf.get(b.book_id) } : b)))
      try {
        await saveRanks('tracked_books', changes)
      } catch (e) {
        setBooks(snapshot)
        onError(
          isMissingSchema(e)
            ? 'Rangement indisponible : relance supabase/schema.sql dans ton projet Supabase.'
            : `Rangement impossible : ${(e as Error).message}`,
        )
      }
    },
    [books, onError],
  )

  const value = useMemo<BooksState>(
    () => ({ books, booksReady, booksLoading, bookById, addBook, updateBook, removeBook, restoreBook, reorderBooks }),
    [books, booksReady, booksLoading, bookById, addBook, updateBook, removeBook, restoreBook, reorderBooks],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useBooks(): BooksState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useBooks doit être utilisé dans <BooksProvider>')
  return ctx
}

/* ------------------------------------------------ gestes de lecture courants -- */

const now = () => new Date().toISOString()

/** Commencer (ou reprendre) un livre : la date de début n'est posée qu'une fois. */
export const startPatch = (b: TrackedBook): BookPatch => ({
  status: 'reading',
  started_at: b.started_at ?? now(),
  finished_at: null,
})

/** Terminer un livre : toutes ses pages sont lues, à la date donnée (ou inconnue). */
export const finishPatch = (b: TrackedBook, finishedAt: string | null = now()): BookPatch => ({
  status: 'read',
  finished_at: finishedAt,
  current_page: b.page_count ?? b.current_page,
})

/** Avancement en pourcentage, null quand le nombre de pages est inconnu. */
export function bookProgress(b: TrackedBook): number | null {
  if (!b.page_count) return null
  return Math.min(100, Math.round((b.current_page / b.page_count) * 100))
}
