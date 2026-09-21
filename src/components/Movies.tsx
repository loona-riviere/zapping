import { useState } from 'react'
import { useApp } from '../lib/appState'
import { formatShortDate } from '../lib/progress'
import { href } from '../lib/route'
import { buildEnvNames, movieDetails, tmdbConfigured } from '../lib/tmdb'
import { Poster } from './Poster'
import type { WatchedMovie } from '../lib/store'

const today = () => new Date().toISOString().slice(0, 10)

/** Insensible aux accents et à la casse : « chateau » retrouve « Château ». */
const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function Movies() {
  const { movies, moviesReady, loading, markMovieWatched, markMovieUnwatched, removeMovie } = useApp()
  const [query, setQuery] = useState('')

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

  const q = normalize(query.trim())
  const matches = (title: string) => !q || normalize(title).includes(q)
  const toWatch = movies.filter((m) => m.status === 'later' && matches(m.title))
  const watched = movies.filter((m) => m.status === 'watched' && matches(m.title))

  /**
   * « Je l'ai vu à sa sortie » : plutôt que la date du jour, reprend la date
   * de sortie connue chez TMDB (une requête, non mise en cache par ailleurs
   * dans la liste — seulement demandée au clic).
   */
  async function markWatchedAtRelease(m: WatchedMovie) {
    const details = await movieDetails(m.movie_id).catch(() => null)
    markMovieWatched(m.movie_id, details?.releaseDate ? `${details.releaseDate}T12:00:00.000Z` : today())
  }

  return (
    <div className="movies">
      <div className="home__search">
        <label htmlFor="movies-q" className="visually-hidden">Chercher dans mes films</label>
        <input
          id="movies-q"
          type="search"
          className="search__input"
          placeholder="Chercher dans mes films…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <h2 className="section-title">
        À voir {toWatch.length > 0 && <span className="muted">({toWatch.length})</span>}
      </h2>
      {loading && <p className="muted">Chargement…</p>}
      {!loading && !toWatch.length && (
        <p className="muted">
          {q ? (
            <>
              Aucun film à voir ne correspond à « {query.trim()} ».{' '}
              <a href={href.searchFor(query.trim(), 'movie')}>Le chercher pour l'ajouter ?</a>
            </>
          ) : (
            <>Aucun film en attente pour l'instant. Cherche-en un dans <a href={href.search}>Chercher</a>.</>
          )}
        </p>
      )}
      <ul className="rows">
        {toWatch.map((m) => (
          <li key={m.movie_id} className="row">
            <a href={href.movie(m.movie_id)} className="row__link">
              <Poster src={m.poster_url} alt={m.title} />
              <div className="row__body">
                <h3>{m.title}</h3>
                <p className="muted">{m.release_year ?? 'Année inconnue'}</p>
              </div>
            </a>
            <div className="row__actions">
              <button className="btn btn--seen" onClick={() => markMovieWatched(m.movie_id, today())}>
                Vu
              </button>
              <button
                className="link-btn muted"
                onClick={() => markWatchedAtRelease(m)}
                title="Marque le film vu à sa date de sortie plutôt qu'aujourd'hui"
              >
                Vu à sa sortie
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
          {q ? (
            <>
              Aucun film vu ne correspond à « {query.trim()} ».{' '}
              <a href={href.searchFor(query.trim(), 'movie')}>Le chercher pour l'ajouter ?</a>
            </>
          ) : (
            <>Aucun film vu pour l'instant. Cherche-en un dans <a href={href.search}>Chercher</a>, ou{' '}
              <a href={href.import}>importe ton historique Netflix</a>.</>
          )}
        </p>
      )}
      <ul className="rows">
        {watched.map((m) => (
          <li key={m.movie_id} className="row">
            <a href={href.movie(m.movie_id)} className="row__link">
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
            </a>
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
