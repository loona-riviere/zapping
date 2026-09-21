import { useEffect, useRef, useState } from 'react'
import { useApp } from '../lib/appState'
import { formatShortDate } from '../lib/progress'
import { href } from '../lib/route'
import { searchMovies, tmdbConfigured, type Movie } from '../lib/tmdb'
import { Poster } from './Poster'

const today = () => new Date().toISOString().slice(0, 10)

export function Movies() {
  const { movies, moviesReady, loading, addMovies, removeMovie } = useApp()
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
    return (
      <section className="empty">
        <h2>Films non configurés</h2>
        <p>
          Les films viennent de TMDB. Crée une clé gratuite sur{' '}
          <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">themoviedb.org</a>,
          puis ajoute <code>VITE_TMDB_KEY</code> dans ton <code>.env</code> et dans les variables
          d'environnement Netlify.
        </p>
      </section>
    )
  }

  const seen = new Set(movies.map((m) => m.movie_id))

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
        </label>
      </div>

      {status === 'error' && (
        <p className="error">
          La recherche TMDB a échoué. Vérifie <code>VITE_TMDB_KEY</code> (la clé v3 de 32
          caractères ou le jeton d'accès v4 conviennent), puis redéploie le site.
        </p>
      )}
      {status === 'idle' && query.trim().length >= 2 && !results.length && (
        <p className="muted">Aucun film trouvé pour « {query.trim()} ».</p>
      )}

      {results.length > 0 && (
        <ul className="rows">
          {results.slice(0, 10).map((m) => (
            <li key={m.id} className="row">
              <div className="row__link">
                <Poster src={m.poster_url} alt={m.title} />
                <div className="row__body">
                  <h3>{m.title}</h3>
                  <p className="muted">{m.year ?? 'Année inconnue'}</p>
                </div>
              </div>
              <button
                className={`btn ${seen.has(m.id) ? 'btn--ghost' : 'btn--primary'}`}
                disabled={seen.has(m.id)}
                onClick={() => addMovies([{ movie: m, watchedAt: date }])}
              >
                {seen.has(m.id) ? 'Vu' : 'Marquer vu'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 className="section-title">Mes films {movies.length > 0 && <span className="muted">({movies.length})</span>}</h2>
      {loading && <p className="muted">Chargement…</p>}
      {!loading && !movies.length && (
        <p className="muted">
          Aucun film pour l'instant. Cherche-en un ci-dessus, ou{' '}
          <a href={href.import}>importe ton historique Netflix</a>.
        </p>
      )}
      <ul className="rows">
        {movies.map((m) => (
          <li key={m.movie_id} className="row">
            <div className="row__link">
              <Poster src={m.poster_url} alt={m.title} />
              <div className="row__body">
                <h3>{m.title}</h3>
                <p className="muted">
                  {[m.release_year, `vu le ${formatShortDate(m.watched_at)}`].filter(Boolean).join(' — ')}
                </p>
              </div>
            </div>
            <button
              className="link-btn muted"
              onClick={() => confirm(`Retirer ${m.title} de tes films ?`) && removeMovie(m.movie_id)}
            >
              Retirer
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
