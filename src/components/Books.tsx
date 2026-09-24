import { useState } from 'react'
import { finishPatch, startPatch, useBooks } from '../lib/booksState'
import type { TrackedBook } from '../lib/bookStore'
import { formatShortDate } from '../lib/progress'
import { href } from '../lib/route'
import { PageInput } from './PageInput'
import { Poster } from './Poster'
import { SwipeRow } from './SwipeRow'

/** Insensible aux accents et à la casse : « etranger » retrouve « L'Étranger ». */
const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Les plus récemment terminés d'abord ; sans date connue, en dernier plutôt qu'en tête. */
function byFinished(a: TrackedBook, b: TrackedBook): number {
  if (a.finished_at && b.finished_at) return b.finished_at.localeCompare(a.finished_at)
  if (a.finished_at) return -1
  if (b.finished_at) return 1
  return a.title.localeCompare(b.title, 'fr')
}

export function Books() {
  const { books, booksReady, booksLoading, updateBook, removeBook, restoreBook } = useBooks()
  const [query, setQuery] = useState('')
  const [showDropped, setShowDropped] = useState(false)
  // Dernier geste de glissé, pour pouvoir l'annuler : un geste rapide se
  // défait aussi vite, sans fenêtre de confirmation à chaque fois.
  const [undo, setUndo] = useState<{ row: TrackedBook; text: string } | null>(null)

  /** Glissé à droite : lu (fini aujourd'hui s'il était en cours, sans date sinon). À gauche : retiré. */
  const swipe = (b: TrackedBook) => ({
    right:
      b.status === 'read'
        ? undefined
        : {
            label: b.status === 'reading' ? 'Terminé' : 'Déjà lu',
            onSwipe: () => {
              setUndo({ row: b, text: `${b.title} — lu.` })
              updateBook(b.book_id, finishPatch(b, b.status === 'reading' ? new Date().toISOString() : null))
            },
          },
    left: {
      label: 'Retirer',
      onSwipe: () => {
        setUndo({ row: b, text: `${b.title} — retiré.` })
        removeBook(b.book_id)
      },
    },
  })

  if (!booksReady) {
    return (
      <section className="empty">
        <h2>Table des livres absente</h2>
        <p>
          Relance <code>supabase/schema.sql</code> dans l'éditeur SQL de ton projet Supabase :
          il crée la table <code>tracked_books</code>. Le script est ré-exécutable, il ne touche
          pas à tes séries ni à tes films.
        </p>
      </section>
    )
  }

  if (!booksLoading && !books.length) {
    return (
      <section className="empty">
        <h2>Aucun livre pour l'instant</h2>
        <p>Cherche un livre pour l'ajouter à ta pile, puis note ta page au fil de la lecture.</p>
        <a className="btn btn--primary" href={href.searchFor('', 'book')}>Chercher un livre</a>
      </section>
    )
  }

  const q = normalize(query.trim())
  const matches = (b: TrackedBook) => !q || normalize(`${b.title} ${b.authors ?? ''}`).includes(q)
  const visible = books.filter(matches)
  const reading = visible
    .filter((b) => b.status === 'reading')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  const later = visible
    .filter((b) => b.status === 'later')
    .sort((a, b) => b.added_at.localeCompare(a.added_at))
  const read = visible.filter((b) => b.status === 'read').sort(byFinished)
  const dropped = visible.filter((b) => b.status === 'dropped')

  const byLine = (b: TrackedBook) => [b.authors, b.published_year].filter(Boolean).join(' · ')

  return (
    <div className="books">
      <div className="home__search">
        <label htmlFor="books-q" className="visually-hidden">Chercher dans mes livres</label>
        <input
          id="books-q"
          type="search"
          className="search__input"
          placeholder="Chercher dans mes livres…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {booksLoading && <p className="muted">Chargement…</p>}

      {q && !visible.length && (
        <p className="muted pad">
          Aucun livre ne correspond à « {query.trim()} ».{' '}
          <a href={href.searchFor(query.trim(), 'book')}>Le chercher pour l'ajouter ?</a>
        </p>
      )}

      {reading.length > 0 && (
        <section>
          <h2 className="section-title">En cours <span className="muted">({reading.length})</span></h2>
          <ul className="rows">
            {reading.map((b) => (
              <SwipeRow key={b.book_id} className="row row--book" {...swipe(b)}>
                <a href={href.book(b.book_id)} className="row__link">
                  <Poster src={b.cover_url} alt={b.title} />
                  <div className="row__body">
                    <h3>{b.title}</h3>
                    {b.authors && <p className="muted">{b.authors}</p>}
                  </div>
                </a>
                <div className="row__actions">
                  <button
                    className="btn btn--seen"
                    onClick={() => confirm(`${b.title} est terminé ?`) && updateBook(b.book_id, finishPatch(b))}
                  >
                    Terminé
                  </button>
                </div>
                <div className="row__extra">
                  <PageInput book={b} compact />
                </div>
              </SwipeRow>
            ))}
          </ul>
        </section>
      )}

      {later.length > 0 && (
        <section>
          <h2 className="section-title">À lire <span className="muted">({later.length})</span></h2>
          <ul className="rows">
            {later.map((b) => (
              <SwipeRow key={b.book_id} {...swipe(b)}>
                <a href={href.book(b.book_id)} className="row__link">
                  <Poster src={b.cover_url} alt={b.title} />
                  <div className="row__body">
                    <h3>{b.title}</h3>
                    <p className="muted">{byLine(b) || 'Auteur inconnu'}</p>
                  </div>
                </a>
                <div className="row__actions">
                  <button className="btn btn--primary" onClick={() => updateBook(b.book_id, startPatch(b))}>
                    Commencer
                  </button>
                  <button
                    className="link-btn muted row__drop"
                    onClick={() => confirm(`Retirer ${b.title} de ta pile ?`) && removeBook(b.book_id)}
                  >
                    Retirer
                  </button>
                </div>
              </SwipeRow>
            ))}
          </ul>
        </section>
      )}

      {read.length > 0 && (
        <section>
          <h2 className="section-title">Lus <span className="muted">({read.length})</span></h2>
          <ul className="rows">
            {read.map((b) => (
              <SwipeRow key={b.book_id} {...swipe(b)}>
                <a href={href.book(b.book_id)} className="row__link">
                  <Poster src={b.cover_url} alt={b.title} />
                  <div className="row__body">
                    <h3>{b.title}</h3>
                    <p className="muted">
                      {[b.authors, b.finished_at ? `lu le ${formatShortDate(b.finished_at)}` : 'date inconnue']
                        .filter(Boolean)
                        .join(' — ')}
                    </p>
                  </div>
                </a>
              </SwipeRow>
            ))}
          </ul>
        </section>
      )}

      {dropped.length > 0 && (
        <section>
          <h2 className="section-title">
            <button
              type="button"
              className="season__toggle"
              aria-expanded={showDropped}
              onClick={() => setShowDropped((v) => !v)}
            >
              <span className="season__chevron" aria-hidden="true">{showDropped ? '▾' : '▸'}</span>
              Abandonnés <span className="muted">({dropped.length})</span>
            </button>
          </h2>
          {showDropped && (
            <ul className="rows">
              {dropped.map((b) => (
                <SwipeRow key={b.book_id} {...swipe(b)}>
                  <a href={href.book(b.book_id)} className="row__link">
                    <Poster src={b.cover_url} alt={b.title} />
                    <div className="row__body">
                      <h3>{b.title}</h3>
                      <p className="muted">
                        {b.page_count ? `arrêté page ${b.current_page} / ${b.page_count}` : byLine(b)}
                      </p>
                    </div>
                  </a>
                </SwipeRow>
              ))}
            </ul>
          )}
        </section>
      )}

      {visible.length > 0 && (
        <p className="muted swipe__hint">
          Sur téléphone : glisse un livre vers la droite pour le marquer lu, vers la gauche pour le retirer.
        </p>
      )}

      {undo && (
        <div className="catchup" role="status">
          <p>{undo.text}</p>
          <div className="catchup__actions">
            <button className="btn btn--ghost" onClick={() => setUndo(null)}>Fermer</button>
            <button
              className="btn btn--primary"
              onClick={() => {
                restoreBook(undo.row)
                setUndo(null)
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {!q && !reading.length && !booksLoading && (
        <p className="muted empty__alt">
          Aucune lecture en cours. <a href={href.searchFor('', 'book')}>Chercher un livre</a>
        </p>
      )}
    </div>
  )
}
