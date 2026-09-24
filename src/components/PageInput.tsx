import { useEffect, useState } from 'react'
import { bookProgress, finishPatch, useBooks } from '../lib/booksState'
import type { TrackedBook } from '../lib/bookStore'

/**
 * « Page 120 / 350 » avec la barre d'avancement. La page s'enregistre en
 * quittant le champ (ou sur Entrée), pas à chaque chiffre tapé : taper « 120 »
 * ne doit pas enregistrer 1, puis 12, puis 120.
 */
export function PageInput({ book, compact = false }: { book: TrackedBook; compact?: boolean }) {
  const { updateBook } = useBooks()
  const [value, setValue] = useState(String(book.current_page || ''))
  const pct = bookProgress(book)

  useEffect(() => setValue(String(book.current_page || '')), [book.current_page])

  function commit() {
    const n = Math.max(0, Math.round(Number(value) || 0))
    const page = book.page_count ? Math.min(n, book.page_count) : n
    if (page === book.current_page) {
      setValue(String(page || ''))
      return
    }
    if (book.page_count && page >= book.page_count && confirm(`Dernière page : ${book.title} est terminé ?`)) {
      updateBook(book.book_id, finishPatch(book))
      return
    }
    updateBook(book.book_id, { current_page: page })
  }

  const id = `page-${book.book_id}`
  return (
    <div className={`pages${compact ? ' pages--compact' : ''}`}>
      <label htmlFor={id} className="pages__label">
        Page
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          max={book.page_count ?? undefined}
          value={value}
          placeholder="0"
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          onClick={(e) => e.stopPropagation()}
        />
        {book.page_count ? <span className="muted">/ {book.page_count}</span> : null}
      </label>
      {pct !== null && (
        <div className="progress">
          <div className="progress__track">
            <div className="progress__fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="progress__label">{pct} %</span>
        </div>
      )}
    </div>
  )
}
