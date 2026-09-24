import { useEffect, useState } from 'react'
import { finishPatch, useBooks } from '../lib/booksState'
import type { TrackedBook } from '../lib/bookStore'

/**
 * « Page 120 / 350 » et une barre d'avancement qui se règle au doigt : la
 * page et le pourcentage suivent en direct, l'enregistrement n'a lieu qu'au
 * lâcher. Le champ numérique reste pour viser une page précise ; lui aussi
 * n'enregistre qu'en quittant le champ (taper « 120 » ne doit pas
 * enregistrer 1, puis 12, puis 120).
 */
export function PageInput({ book, compact = false }: { book: TrackedBook; compact?: boolean }) {
  const { updateBook } = useBooks()
  const [page, setPage] = useState(book.current_page)
  const [typed, setTyped] = useState(String(book.current_page || ''))

  useEffect(() => {
    setPage(book.current_page)
    setTyped(String(book.current_page || ''))
  }, [book.current_page])

  function commit(raw: number) {
    const n = Math.max(0, Math.round(raw || 0))
    const next = book.page_count ? Math.min(n, book.page_count) : n
    setPage(next)
    setTyped(String(next || ''))
    if (next === book.current_page) return
    if (book.page_count && next >= book.page_count && confirm(`Dernière page : ${book.title} est terminé ?`)) {
      updateBook(book.book_id, finishPatch(book))
      return
    }
    updateBook(book.book_id, { current_page: next })
  }

  const pct = book.page_count ? Math.min(100, Math.round((page / book.page_count) * 100)) : null
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
          value={typed}
          placeholder="0"
          onChange={(e) => {
            setTyped(e.target.value)
            if (e.target.value !== '') setPage(Math.max(0, Number(e.target.value) || 0))
          }}
          onBlur={() => commit(Number(typed))}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          onClick={(e) => e.stopPropagation()}
        />
        {book.page_count ? <span className="muted">/ {book.page_count}</span> : null}
        {pct !== null && <span className="pages__pct">{pct} %</span>}
      </label>
      {book.page_count ? (
        <input
          type="range"
          className="pages__slider"
          min={0}
          max={book.page_count}
          step={1}
          value={page}
          style={{ ['--pct' as string]: `${pct ?? 0}%` }}
          aria-label={`Avancement de ${book.title}`}
          aria-valuetext={`Page ${page} sur ${book.page_count}, ${pct} %`}
          // La barre se tire de côté : sans ça, le geste ferait glisser toute la ligne.
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const n = Number(e.target.value)
            setPage(n)
            setTyped(String(n || ''))
          }}
          onPointerUp={() => commit(page)}
          onKeyUp={() => commit(page)}
          onBlur={() => page !== book.current_page && commit(page)}
        />
      ) : null}
    </div>
  )
}
