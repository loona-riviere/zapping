import { useEffect, useRef, useState } from 'react'
import { useApp } from '../lib/appState'
import { formatShortDate } from '../lib/progress'
import { href } from '../lib/route'
import { buildEnvNames, searchMovies, tmdbConfigured, type Movie } from '../lib/tmdb'
import { Poster } from './Poster'
import { MovieRecommendations } from './Recommendations'

const today = () => new Date().toISOString().slice(0, 10)

export function Movies() {
  const { movies, moviesReady, loading, addMovies, addToWatchlist, markMovieWatched, markMovieUnwatched, removeMovie } = useApp()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Movie[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [date, setDate] = useState(today)
  const input = useRef<HTMLInputElement>(null)

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

  if (!moviesReady) {
    return (
      <section className="empty">
        <h2>Table des films absente</h2>
        <p>
          Relance <code>supabase/schema.sql</code> dans l'éditeur SQL de ton projet Supabase :
          il crée la table <code>watched_movies</code>. Le script est ré-exécutable, il ne touche
          pas à tes séries.
        </p>
      </section>
    )
  }

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
  const toWatch = movies.filter((m) => m.status === 'later')
  const watched = movies.filter((m) => m.status === 'watched')

  return (
    <div className="movies">
      <h2 className="section-title">Ajouter un film</h2>
      <div className="movies__add">
        <label htmlFor="mq" className="visually-hidden">Titre du film</label>
        <input
          id="mq"
          ref={input}
          type="search"
          className="search__input"
          placeholder="Titre du film"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        <label className="movies__date">
          Vu le
          <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
          {date && (
            <button className="link-btn" onClick={() => setDate('')} title="Je ne sais plus quand">
              oublier
            </button>
          )}
        </label>
      </div>

      {status === 'error' && (
        <p className="error">
          La recherche TMDB a échoué. Vérifie <code>VITE_TMDB_KEY</code> (la clé v3 de 32
          caractères ou le jeton d'accès v4 conviennent), puis redéploie le site.
        </p>
      )}
      {!date && (
        <p className="muted movies__hint">
          Sans date, le film est enregistré comme vu sans quand — mieux qu'une date inventée,
          qui fausserait les statistiques.
        </p>
      )}
      {status === 'idle' && query.trim().length >= 2 && !results.length && (
        <p className="muted">Aucun film trouvé pour « {query.trim()} ».</p>
      )}

      {results.length > 0 && (
        <ul className="rows">
          {results.slice(0, 10).map((m) => {
            const existing = byId.get(m.id)
            return (
              <li key={m.id} className="row">
                <div className="row__link">
                  <Poster src={m.poster_url} alt={m.title} />
                  <div className="row__body">
                    <h3>{m.title}</h3>
                    <p className="muted">{m.year ?? 'Année inconnue'}</p>
                  </div>
                </div>
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
      )}

      <MovieRecommendations />

      <h2 className="section-title">
        À voir {toWatch.length > 0 && <span className="muted">({toWatch.length})</span>}
      </h2>
      {loading && <p className="muted">Chargement…</p>}
      {!loading && !toWatch.length && <p className="muted">Aucun film en attente pour l'instant.</p>}
      <ul className="rows">
        {toWatch.map((m) => (
          <li key={m.movie_id} className="row">
            <div className="row__link">
              <Poster src={m.poster_url} alt={m.title} />
              <div className="row__body">
                <h3>{m.title}</h3>
                <p className="muted">{m.release_year ?? 'Année inconnue'}</p>
              </div>
            </div>
            <div className="row__actions">
              <button className="btn btn--seen" onClick={() => markMovieWatched(m.movie_id, today())}>
                Vu
              </button>
              <button
                className="link-btn muted"
                onClick={() => confirm(`Retirer ${m.title} de tes films à voir ?`) && removeMovie(m.movie_id)}
              >
                Retirer
              </button>
            </div>
          </li>
        ))}
      </ul>

      <h2 className="section-title">
        Vus {watched.length > 0 && <span className="muted">({watched.length})</span>}
      </h2>
      {!loading && !watched.length && (
        <p className="muted">
          Aucun film vu pour l'instant. Cherche-en un ci-dessus, ou{' '}
          <a href={href.import}>importe ton historique Netflix</a>.
        </p>
      )}
      <ul className="rows">
        {watched.map((m) => (
          <li key={m.movie_id} className="row">
            <div className="row__link">
              <Poster src={m.poster_url} alt={m.title} />
              <div className="row__body">
                <h3>{m.title}</h3>
                <p className="muted">
                  {[
                    m.release_year,
                    m.watched_at ? `vu le ${formatShortDate(m.watched_at)}` : 'date inconnue',
                  ]
                    .filter(Boolean)
                    .join(' — ')}
                </p>
              </div>
            </div>
            <div className="row__actions">
              <button
                className="link-btn muted"
                onClick={() => markMovieUnwatched(m.movie_id)}
                title="Remettre dans « à voir »"
              >
                Pas vu
              </button>
              <button
                className="link-btn muted"
                onClick={() => confirm(`Retirer ${m.title} de tes films ?`) && removeMovie(m.movie_id)}
              >
                Retirer
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
