import { useEffect, useState } from 'react'
import { bookDetails, type Book } from '../lib/books'
import { finishPatch, startPatch, useBooks } from '../lib/booksState'
import { type BookPatch, type BookStatus, type TrackedBook } from '../lib/bookStore'
import { formatShortDate } from '../lib/progress'
import { href } from '../lib/route'
import { FriendsOn } from './FriendsOn'
import { friendsOnBook } from '../lib/friendsOn'
import { ActionBar, ChoiceAction, RatingAction } from './ActionBar'
import { RecommendButton } from './Recommend'
import { Summary } from './Summary'
import { DateField, History } from './History'
import { Comments } from './Comments'
import { PageInput } from './PageInput'
import { Poster } from './Poster'
import { SkeletonPage } from './Skeleton'

/** « Lu du 3 au 10 août 2026 », « Commencé le 3 août 2026 »… en une ligne. */
function datesLabel(status: BookStatus, start: string | null, end: string | null): string {
  const d = (x: string) => formatShortDate(x)
  if (status === 'read') {
    if (start && end) return `Lu du ${d(start)} au ${d(end)}`
    if (end) return `Lu le ${d(end)}`
    if (start) return `Commencé le ${d(start)}`
    return 'Lu, date inconnue'
  }
  if (status === 'dropped') return start ? `Arrêté, commencé le ${d(start)}` : 'Arrêté'
  return start ? `En cours depuis le ${d(start)}` : 'En cours'
}

/** Ce que change le passage d'un statut à l'autre, au-delà du statut lui-même. */
function statusPatch(b: TrackedBook, status: BookStatus): BookPatch {
  if (status === 'reading') return startPatch(b)
  if (status === 'read') return finishPatch(b)
  return { status }
}

const BOOK_STATUS_OPTIONS: { value: BookStatus; icon: string; label: string; hint: string }[] = [
  { value: 'reading', icon: '📖', label: 'En cours', hint: 'Tu le lis en ce moment' },
  { value: 'later', icon: '🔖', label: 'À lire', hint: 'Dans ta pile' },
  { value: 'read', icon: '✓', label: 'Lu', hint: 'Terminé' },
  { value: 'dropped', icon: '⏸️', label: 'Abandonné', hint: 'Arrêté en cours de route' },
]

export function BookPage({ id }: { id: string }) {
  const { bookById, addBook, updateBook, removeBook, booksReady } = useBooks()
  const [details, setDetails] = useState<Book | null>(null)
  const [error, setError] = useState(false)
  const [editDates, setEditDates] = useState(false)
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
  if (!book && !details) return <SkeletonPage />

  const title = book?.title ?? details!.title
  const authors = book?.authors ?? (details?.authors.length ? details.authors.join(', ') : null)
  const cover = book?.cover_url ?? details?.cover_url ?? null
  const year = book?.published_year ?? details?.year ?? null
  const pages = book?.page_count ?? details?.page_count ?? null
  const recItem = {
    kind: 'book' as const,
    itemId: id,
    title,
    image: cover,
    meta: {
      kind: 'book' as const,
      book: details ?? {
        id,
        title,
        authors: authors ? authors.split(', ') : [],
        cover_url: cover,
        page_count: pages,
        year,
        description: null,
        categories: [],
      },
    },
  }

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

        {book && (book.status === 'reading' || book.status === 'dropped') && (
          <section className="readcard">
            <PageInput book={book} />
            {!book.page_count && (
              <label className="pages__label">
                Le livre fait
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
                pages
              </label>
            )}
            {book.status === 'reading' && (
              <button className="btn btn--seen readcard__done" onClick={() => updateBook(book.book_id, finishPatch(book))}>
                ✓ J'ai terminé
              </button>
            )}
          </section>
        )}

        {book && (
          <ActionBar>
            <ChoiceAction
              title="Où en es-tu ?"
              value={book.status}
              options={BOOK_STATUS_OPTIONS}
              onChange={(v) => updateBook(book.book_id, statusPatch(book, v))}
            />
            {book.status === 'read' && (
              <RatingAction rating={book.rating} onChange={(r) => updateBook(book.book_id, { rating: r })} />
            )}
            <RecommendButton item={recItem} />
          </ActionBar>
        )}
        {!book && <ActionBar><RecommendButton item={recItem} /></ActionBar>}
        <FriendsOn noun="lu" load={(ids) => friendsOnBook(id, ids)} />


        {book && (
          <History
            title="Lectures"
            actions={
              book.status === 'read' && (
                <button
                  type="button"
                  className="pill pill--small"
                  onClick={() =>
                    updateBook(book.book_id, {
                      past_reads: [...(book.past_reads ?? []), { started_at: book.started_at, finished_at: book.finished_at }],
                      status: 'reading',
                      started_at: new Date().toISOString(),
                      finished_at: null,
                      current_page: 0,
                    })
                  }
                >
                  🔁 Relire
                </button>
              )
            }
            editing={editDates}
            onToggle={() => setEditDates((v) => !v)}
            entries={[
              ...(book.status !== 'later'
                ? [
                    {
                      key: 'now',
                      icon: book.status === 'read' ? '✓' : book.status === 'reading' ? '📖' : '⏸',
                      text: datesLabel(book.status, book.started_at, book.finished_at),
                      edit: (
                        <span className="hist__dates">
                          <DateField label="Début" value={book.started_at} onChange={(v) => updateBook(book.book_id, { started_at: v })} />
                          {book.status === 'read' && (
                            <DateField label="Fin" value={book.finished_at} onChange={(v) => updateBook(book.book_id, { finished_at: v })} />
                          )}
                        </span>
                      ),
                    },
                  ]
                : []),
              ...(book.past_reads ?? [])
                .map((r, i) => ({ r, i }))
                .reverse()
                .map(({ r, i }) => ({
                  key: `past-${i}`,
                  icon: '✓',
                  text: r.finished_at ? `Lu le ${formatShortDate(r.finished_at)}` : 'Lu, date inconnue',
                  edit: (
                    <DateField
                      label="Fin"
                      value={r.finished_at}
                      onChange={(v) =>
                        updateBook(book.book_id, {
                          past_reads: (book.past_reads ?? []).map((x, j) => (j === i ? { ...x, finished_at: v } : x)),
                        })
                      }
                    />
                  ),
                  onRemove: () =>
                    confirm('Supprimer cette lecture ?') &&
                    updateBook(book.book_id, { past_reads: (book.past_reads ?? []).filter((_, j) => j !== i) }),
                })),
            ]}
            extra={
              <DateField
                label="Ajouter une lecture finie le"
                value={null}
                onChange={(v) => {
                  if (!v) return
                  const past = [...(book.past_reads ?? []), { started_at: null, finished_at: v }]
                  past.sort((a, b) => (a.finished_at ?? '').localeCompare(b.finished_at ?? ''))
                  updateBook(book.book_id, { past_reads: past })
                }}
              />
            }
          />
        )}
      </div>

      {details?.description && <Summary text={details.description} />}

      <Comments kind="book" itemId={id} title={title} seen={book?.status === 'read' || !!book?.past_reads?.length} />

      {book && (
        <button
          type="button"
          className="link-btn muted show__untrack"
          onClick={() =>
            confirm(`Retirer ${title} de tes livres ? Sa page et ses dates seront perdues.`) && removeBook(book.book_id)
          }
        >
          Retirer de mes livres
        </button>
      )}
    </article>
  )
}
