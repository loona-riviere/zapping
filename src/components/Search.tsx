import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../lib/appState'
import { searchShowsWide } from '../lib/lookup'
import { computeProgress, epCode, type Progress } from '../lib/progress'
import { href, type SearchKind } from '../lib/route'
import { manualBook, searchBooks, type Book } from '../lib/books'
import type { BookStatus } from '../lib/bookStore'
import { useBooks } from '../lib/booksState'
import { buildEnvNames, searchMovies, tmdbConfigured, type Movie } from '../lib/tmdb'
import type { TvShow } from '../lib/tvmaze'
import { useShowEpisodes } from '../lib/useShows'
import { Poster } from './Poster'
import { MovieRecommendations, ShowRecommendations } from './Recommendations'

type Kind = SearchKind
type ContinuingRow = { id: number; name: string; image: string | null; next: NonNullable<Progress['next']> }

const today = () => new Date().toISOString().slice(0, 10)

const PLACEHOLDER: Record<Kind, string> = {
  show: 'Nom de la série',
  movie: 'Titre du film',
  book: 'Titre, auteur ou ISBN',
}

/**
 * Un seul endroit pour trouver du nouveau contenu, séries ou films, plutôt
 * qu'une recherche cachée dans chaque bibliothèque : le bouton bascule le
 * type cherché, la recherche elle-même reste la même pour les deux.
 */
export function Search({ initialQuery, initialKind }: { initialQuery?: string; initialKind?: Kind } = {}) {
  const [kind, setKind] = useState<Kind>(initialKind ?? 'show')
  const [query, setQuery] = useState(initialQuery ?? '')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [kind])

  return (
    <div className="search">
      <div className="subtabs" role="tablist" aria-label="Type recherché">
        <button
          type="button"
          role="tab"
          aria-selected={kind === 'show'}
          onClick={() => setKind('show')}
        >
          Séries
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={kind === 'movie'}
          onClick={() => setKind('movie')}
        >
          Films
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={kind === 'book'}
          onClick={() => setKind('book')}
        >
          Livres
        </button>
      </div>

      <label htmlFor="q" className="visually-hidden">
        {PLACEHOLDER[kind]}
      </label>
      <input
        id="q"
        ref={input}
        type="search"
        className="search__input"
        placeholder={PLACEHOLDER[kind]}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />

      {kind === 'show' && <ShowSearch query={query} />}
      {kind === 'movie' && <MovieSearch query={query} />}
      {kind === 'book' && <BookSearch query={query} />}
    </div>
  )
}

function ShowSearch({ query }: { query: string }) {
  const { tracked, watchedFor, isTracked, track } = useApp()
  const [results, setResults] = useState<TvShow[]>([])
  // Titre original ayant permis de trouver, quand le titre français a échoué.
  const [via, setVia] = useState<string | null>(null)
  const [tried, setTried] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  // Avant de proposer de nouvelles séries, on rappelle où on en est dans
  // celles déjà en cours : ce qu'on regarde déjà passe avant la découverte.
  const continuingIds = useMemo(
    () =>
      tracked
        .filter((t) => t.status === 'watching')
        .sort((a, b) => (b.last_watched_at ?? '').localeCompare(a.last_watched_at ?? ''))
        .slice(0, 5)
        .map((t) => t.show_id),
    [tracked],
  )
  const { data: continuingCache } = useShowEpisodes(continuingIds)
  const continuing = useMemo(
    () =>
      continuingIds
        .map((id) => {
          const data = continuingCache[id]
          const t = tracked.find((tr) => tr.show_id === id)
          if (!data || !t) return null
          const progress = computeProgress(data.episodes, watchedFor(id))
          return progress.next
            ? { id, name: data.show.name, image: data.show.image?.medium ?? t.image_url, next: progress.next }
            : null
        })
        .filter((r): r is ContinuingRow => !!r),
    [continuingIds, continuingCache, tracked, watchedFor],
  )

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setVia(null)
      setTried([])
      setStatus('idle')
      return
    }
    setStatus('loading')
    let alive = true
    const t = setTimeout(() => {
      searchShowsWide(q)
        .then((r) => {
          if (!alive) return
          setResults(r.results)
          setVia(r.via ?? null)
          setTried(r.tried)
          setStatus('idle')
        })
        .catch(() => alive && setStatus('error'))
    }, 350)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query])

  return (
    <>
      {status === 'error' && <p className="error">La recherche TVmaze a échoué. Vérifie ta connexion et réessaie.</p>}
      {status === 'idle' && query.trim().length >= 2 && !results.length && (
        <p className="muted">
          Aucune série trouvée pour « {query.trim()} ».{' '}
          {tried.length
            ? `TMDB propose ${tried.slice(0, 3).map((t) => `« ${t} »`).join(', ')}, que TVmaze ne connaît pas non plus.`
            : tmdbConfigured
              ? "TMDB ne connaît aucune série sous ce titre non plus : vérifie l'orthographe, ou cherche l'œuvre sur themoviedb.org pour relever son titre d'origine."
              : 'Essaie le titre original.'}
        </p>
      )}
      {via && (
        <p className="muted">Rien sous « {query.trim()} » — voici les résultats pour « {via} ».</p>
      )}
      {!query.trim() && continuing.length > 0 && (
        <section>
          <h2 className="section-title">Reprendre</h2>
          <ul className="rows">
            {continuing.map((r) => (
              <li key={r.id} className="row">
                <a href={href.show(r.id)} className="row__link">
                  <Poster src={r.image} alt={r.name} />
                  <div className="row__body">
                    <h3>{r.name}</h3>
                    <p className="row__next">
                      <strong>{epCode(r.next)}</strong> {r.next.name}
                    </p>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!query.trim() && <ShowRecommendations />}
      <ul className="rows">
        {results.map((s) => {
          const year = s.premiered?.slice(0, 4)
          const channel = s.network?.name ?? s.webChannel?.name
          const followed = isTracked(s.id)
          return (
            <li key={s.id} className="row">
              <a href={href.show(s.id)} className="row__link">
                <Poster src={s.image?.medium} alt={s.name} />
                <div className="row__body">
                  <h3>{s.name}</h3>
                  <p className="muted">{[year, channel].filter(Boolean).join(', ')}</p>
                </div>
              </a>
              <button
                className={`btn ${followed ? 'btn--ghost' : 'btn--primary'}`}
                disabled={followed}
                onClick={() => track(s)}
              >
                {followed ? 'Suivie' : 'Suivre'}
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function MovieSearch({ query }: { query: string }) {
  const { movies, addMovies, addToWatchlist, markMovieWatched } = useApp()
  const [results, setResults] = useState<Movie[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [date, setDate] = useState(today)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setStatus('idle')
      return
    }
    setStatus('loading')
    let alive = true
    const t = setTimeout(() => {
      searchMovies(q)
        .then((r) => alive && (setResults(r), setStatus('idle')))
        .catch(() => alive && setStatus('error'))
    }, 350)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query])

  if (!tmdbConfigured) {
    const names = buildEnvNames()
    return (
      <section className="empty">
        <h2>Films non configurés</h2>
        <p>
          Les films viennent de TMDB. Crée un accès gratuit sur{' '}
          <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">themoviedb.org</a>,
          puis ajoute <code>VITE_TMDB_KEY</code> dans ton <code>.env</code> et dans les variables
          d'environnement Netlify. La clé v3 (32 caractères) comme le jeton v4 conviennent.
        </p>
        <p className="diag">
          Variables reçues à la construction de ce site :{' '}
          {names.length ? <code>{names.join(', ')}</code> : <em>aucune</em>}.
          <br />
          {names.includes('VITE_TMDB_KEY')
            ? "VITE_TMDB_KEY est bien arrivée mais sa valeur est vide."
            : "VITE_TMDB_KEY n'est pas arrivée jusqu'au build : vérifie l'orthographe du nom, la portée de la variable (elle doit couvrir « Builds ») et relance un déploiement."}
        </p>
      </section>
    )
  }

  const byId = new Map(movies.map((m) => [m.movie_id, m]))

  return (
    <>
      <label className="movies__date">
        Vu le
        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        {date && (
          <button className="link-btn" onClick={() => setDate('')} title="Je ne sais plus quand">
            oublier
          </button>
        )}
      </label>
      {!date && (
        <p className="muted movies__hint">
          Sans date, le film est enregistré comme vu sans quand — mieux qu'une date inventée,
          qui fausserait les statistiques.
        </p>
      )}

      {status === 'error' && (
        <p className="error">
          La recherche TMDB a échoué. Vérifie <code>VITE_TMDB_KEY</code> (la clé v3 de 32
          caractères ou le jeton d'accès v4 conviennent), puis redéploie le site.
        </p>
      )}
      {status === 'idle' && query.trim().length >= 2 && !results.length && (
        <p className="muted">Aucun film trouvé pour « {query.trim()} ».</p>
      )}
      {!query.trim() && <MovieRecommendations />}

      <ul className="rows">
        {results.slice(0, 10).map((m) => {
          const existing = byId.get(m.id)
          return (
            <li key={m.id} className="row">
              <a href={href.movie(m.id)} className="row__link">
                <Poster src={m.poster_url} alt={m.title} />
                <div className="row__body">
                  <h3>{m.title}</h3>
                  <p className="muted">{m.year ?? 'Année inconnue'}</p>
                </div>
              </a>
              <div className="row__actions">
                <button
                  className={`btn ${existing?.status === 'watched' ? 'btn--ghost' : 'btn--primary'}`}
                  disabled={existing?.status === 'watched'}
                  onClick={() =>
                    existing?.status === 'later'
                      ? markMovieWatched(m.id, date || null)
                      : addMovies([{ movie: m, watchedAt: date || null }])
                  }
                >
                  {existing?.status === 'watched' ? 'Vu' : 'Marquer vu'}
                </button>
                {!existing && (
                  <button className="btn btn--ghost" onClick={() => addToWatchlist(m)}>
                    À voir
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function BookSearch({ query }: { query: string }) {
  const { books, addBook, updateBook } = useBooks()
  const [results, setResults] = useState<Book[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setStatus('idle')
      return
    }
    setStatus('loading')
    let alive = true
    const t = setTimeout(() => {
      searchBooks(q)
        .then((r) => alive && (setResults(r), setStatus('idle')))
        .catch(() => alive && setStatus('error'))
    }, 350)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query])

  const byId = new Map(books.map((b) => [b.book_id, b]))
  // Avant de chercher de nouveaux livres, on rappelle ceux déjà en cours.
  const reading = books.filter((b) => b.status === 'reading').slice(0, 5)

  return (
    <>
      {status === 'error' && <p className="error">La recherche de livres a échoué. Vérifie ta connexion et réessaie.</p>}
      {status === 'idle' && query.trim().length >= 2 && !results.length && (
        <p className="muted">Aucun livre trouvé pour « {query.trim()} ». Essaie avec le titre seul, ou ajoute-le à la main.</p>
      )}
      {status === 'idle' && query.trim().length >= 2 && <ManualBook query={query.trim()} onAdd={addBook} />}
      {!query.trim() && reading.length > 0 && (
        <section>
          <h2 className="section-title">En cours de lecture</h2>
          <ul className="rows">
            {reading.map((b) => (
              <li key={b.book_id} className="row">
                <a href={href.book(b.book_id)} className="row__link">
                  <Poster src={b.cover_url} alt={b.title} />
                  <div className="row__body">
                    <h3>{b.title}</h3>
                    <p className="muted">
                      {b.page_count ? `Page ${b.current_page} / ${b.page_count}` : `Page ${b.current_page}`}
                    </p>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="rows">
        {results.map((b) => {
          const existing = byId.get(b.id)
          return (
            <li key={b.id} className="row">
              <a href={href.book(b.id)} className="row__link">
                <Poster src={b.cover_url} alt={b.title} />
                <div className="row__body">
                  <h3>{b.title}</h3>
                  <p className="muted">
                    {[b.authors.slice(0, 2).join(', '), b.year, b.page_count ? `${b.page_count} p.` : null]
                      .filter(Boolean)
                      .join(' · ') || 'Auteur inconnu'}
                  </p>
                </div>
              </a>
              <div className="row__actions">
                {existing ? (
                  existing.status === 'later' ? (
                    <button
                      className="btn btn--primary"
                      onClick={() =>
                        updateBook(existing.book_id, { status: 'reading', started_at: new Date().toISOString() })
                      }
                    >
                      Commencer
                    </button>
                  ) : (
                    <button className="btn btn--ghost" disabled>
                      {existing.status === 'read' ? 'Lu' : existing.status === 'reading' ? 'En cours' : 'Abandonné'}
                    </button>
                  )
                ) : (
                  <>
                    <button className="btn btn--primary" onClick={() => addBook(b, 'reading')}>
                      Je le lis
                    </button>
                    <button className="btn btn--ghost" onClick={() => addBook(b, 'later')}>
                      À lire
                    </button>
                    <button
                      className="link-btn muted row__drop"
                      onClick={() => addBook(b, 'read')}
                      title="Déjà lu, sans date : tu pourras la préciser sur sa fiche"
                    >
                      Déjà lu
                    </button>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

/**
 * Un livre absent des catalogues (petit éditeur, parution récente) : on le
 * saisit soi-même plutôt que de rester bloqué. Le titre reprend la recherche.
 */
function ManualBook({ query, onAdd }: { query: string; onAdd: (b: Book, status: BookStatus) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(query)
  const [author, setAuthor] = useState('')
  const [pages, setPages] = useState('')
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => setTitle(query), [query])

  if (done) {
    return (
      <p className="muted manual-book__done">
        {done} ajouté à tes livres. <a href={href.books}>Voir mes livres</a>
      </p>
    )
  }
  if (!open) {
    return (
      <p className="muted manual-book__toggle">
        Pas dans la liste ?{' '}
        <button type="button" className="link-btn" onClick={() => setOpen(true)}>
          Ajouter un livre à la main
        </button>
      </p>
    )
  }

  const add = async (status: BookStatus) => {
    if (!title.trim()) return
    await onAdd(manualBook(title, author, Math.round(Number(pages)) || null), status)
    setDone(title.trim())
    setOpen(false)
  }

  return (
    <form className="manual-book" onSubmit={(e) => e.preventDefault()}>
      <label>
        Titre
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label>
        Auteur
        <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Facultatif" />
      </label>
      <label>
        Pages
        <input
          type="number"
          inputMode="numeric"
          min={1}
          value={pages}
          onChange={(e) => setPages(e.target.value)}
          placeholder="Facultatif"
        />
      </label>
      <div className="movie__actions">
        <button type="button" className="btn btn--primary" disabled={!title.trim()} onClick={() => add('reading')}>
          Je le lis
        </button>
        <button type="button" className="btn btn--ghost" disabled={!title.trim()} onClick={() => add('later')}>
          À lire
        </button>
        <button type="button" className="btn btn--ghost" disabled={!title.trim()} onClick={() => add('read')}>
          Déjà lu
        </button>
      </div>
    </form>
  )
}
