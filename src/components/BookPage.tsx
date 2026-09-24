import { useEffect, useState } from 'react'
import { bookDetails, type Book } from '../lib/books'
import { finishPatch, startPatch, useBooks } from '../lib/booksState'
import { BOOK_STATUSES, BOOK_STATUS_LABEL, type BookPatch, type BookStatus, type TrackedBook } from '../lib/bookStore'
import { href } from '../lib/route'
import { PageInput } from './PageInput'
import { Poster } from './Poster'
import { RatingPicker } from './RatingPicker'

const today = () => new Date().toISOString().slice(0, 10)
/** Midi UTC : une date choisie au calendrier reste le même jour quel que soit le fuseau. */
const atNoon = (day: string) => `${day}T12:00:00.000Z`

/** Ce que change le passage d'un statut à l'autre, au-delà du statut lui-même. */
function statusPatch(b: TrackedBook, status: BookStatus): BookPatch {
  if (status === 'reading') return startPatch(b)
  if (status === 'read') return finishPatch(b)
  return { status }
}

export function BookPage({ id }: { id: string }) {
  const { bookById, addBook, updateBook, removeBook, booksReady } = useBooks()
  const [details, setDetails] = useState<Book | null>(null)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const book = bookById(id)

  useEffect(() => {
    let alive = true
    setDetails(null)
    setError(false)
    bookDetails(id)
      .then((d) => alive && (d ? setDetails(d) : setError(true)))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [id])

  // Couverture ou nombre de pages manquants à l'ajout : on les complète dès
  // que la fiche détail les connaît.
  useEffect(() => {
    if (!details || !book) return
    const patch: BookPatch = {}
    if (!book.cover_url && details.cover_url) patch.cover_url = details.cover_url
    if (!book.page_count && details.page_count) patch.page_count = details.page_count
    if (Object.keys(patch).length) updateBook(book.book_id, patch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details, book?.book_id, book?.cover_url, book?.page_count])

  // Un livre suivi s'affiche même si la source ne répond plus : tout ce qu'il
  // faut est déjà en base.
  if (error && !book) {
    return <p className="error pad">Impossible de charger ce livre. <a href={href.search}>Retour</a></p>
  }
  if (!book && !details) return <p className="muted pad">Chargement…</p>

  const title = book?.title ?? details!.title
  const authors = book?.authors ?? (details?.authors.length ? details.authors.join(', ') : null)
  const cover = book?.cover_url ?? details?.cover_url ?? null
  const year = book?.published_year ?? details?.year ?? null
  const pages = book?.page_count ?? details?.page_count ?? null

  return (
    <article className="show">
      <header className="show__head">
        <Poster src={cover} alt={title} size="lg" />
        <div className="show__meta">
          <h1>{title}</h1>
          {authors && <p className="book__authors">{authors}</p>}
          <p className="muted">
            {[year, pages ? `${pages} pages` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {book && (
            <select
              className="status-picker"
              aria-label="Statut de lecture"
              value={book.status}
              data-status={book.status === 'dropped' ? 'dropped' : undefined}
              onChange={(e) => updateBook(book.book_id, statusPatch(book, e.target.value as BookStatus))}
            >
              {BOOK_STATUSES.map((s) => (
                <option key={s} value={s}>{BOOK_STATUS_LABEL[s]}</option>
              ))}
            </select>
          )}
        </div>
      </header>

      <div className="show__controls">
        {!book && details && (
          <div className="movie__actions">
            <button className="btn btn--primary" onClick={() => addBook(details, 'reading')}>
              Je le lis
            </button>
            <button className="btn btn--ghost" onClick={() => addBook(details, 'later')}>
              À lire
            </button>
            <button
              className="btn btn--ghost"
              onClick={() => addBook(details, 'read')}
              title="Déjà lu, sans date : tu pourras la préciser juste après"
            >
              Déjà lu
            </button>
          </div>
        )}
        {!booksReady && (
          <p className="error">Livres indisponibles : relance supabase/schema.sql dans ton projet Supabase.</p>
        )}

        {book && (book.status === 'reading' || book.status === 'dropped') && <PageInput book={book} />}

        {book?.status === 'reading' && (
          <button className="btn btn--seen" onClick={() => updateBook(book.book_id, finishPatch(book))}>
            Terminé
          </button>
        )}

        {book && !book.page_count && (
          <label className="pages__label">
            Nombre de pages
            <input
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="?"
              onBlur={(e) => {
                const n = Math.round(Number(e.target.value))
                if (n > 0) updateBook(book.book_id, { page_count: n })
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            />
          </label>
        )}

        {book && book.status !== 'later' && (
          <>
          <div className="book__dates">
            <label>
              Commencé le
              <input
                type="date"
                value={book.started_at?.slice(0, 10) ?? ''}
                max={today()}
                onChange={(e) => updateBook(book.book_id, { started_at: e.target.value ? atNoon(e.target.value) : null })}
              />
              {book.started_at && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => updateBook(book.book_id, { started_at: null })}
                  title="Je ne sais plus quand"
                >
                  oublier
                </button>
              )}
            </label>
            {book.status === 'read' && (
              <label>
                Fini le
                <input
                  type="date"
                  value={book.finished_at?.slice(0, 10) ?? ''}
                  max={today()}
                  onChange={(e) => updateBook(book.book_id, { finished_at: e.target.value ? atNoon(e.target.value) : null })}
                />
                {book.finished_at && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => updateBook(book.book_id, { finished_at: null })}
                    title="Je ne sais plus quand : le livre reste lu, sans date"
                  >
                    oublier
                  </button>
                )}
              </label>
            )}
          </div>
          {(book.started_at || book.finished_at) && (
            <button
              type="button"
              className="link-btn muted"
              style={{ fontSize: '.85rem' }}
              onClick={() => updateBook(book.book_id, { started_at: null, finished_at: null })}
            >
              Effacer les dates (lu il y a longtemps, sans savoir quand)
            </button>
          )}
          </>
        )}

        {book?.status === 'read' && (
          <RatingPicker rating={book.rating} onChange={(r) => updateBook(book.book_id, { rating: r })} />
        )}

        {book && (
          <button
            type="button"
            className="link-btn muted show__untrack"
            onClick={() =>
              confirm(`Retirer ${title} de tes livres ? Sa page et ses dates seront perdues.`) &&
              removeBook(book.book_id)
            }
          >
            Retirer de mes livres
          </button>
        )}
      </div>

      {details?.description && (
        <>
          <p className={`show__summary${expanded ? '' : ' show__summary--clamped'}`} style={{ whiteSpace: 'pre-line' }}>
            {details.description}
          </p>
          {details.description.length > 240 && (
            <button className="link-btn show__summary-more" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Réduire' : 'Lire la suite'}
            </button>
          )}
        </>
      )}
    </article>
  )
}
