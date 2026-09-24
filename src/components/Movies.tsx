import { useEffect, useState } from 'react'
import { useApp } from '../lib/appState'
import { formatShortDate } from '../lib/progress'
import { href } from '../lib/route'
import { buildEnvNames, movieDetails, tmdbConfigured } from '../lib/tmdb'
import { Poster } from './Poster'
import { SwipeRow } from './SwipeRow'
import type { WatchedMovie } from '../lib/store'

const today = () => new Date().toISOString().slice(0, 10)

/** Une date connue et future : le film n'est pas encore sorti. Sans date connue, on ne bloque rien. */
const notYetReleased = (m: WatchedMovie) => !!m.release_date && m.release_date > today()

/** Insensible aux accents et à la casse : « chateau » retrouve « Château ». */
const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function Movies() {
  const { movies, moviesReady, loading, markMovieWatched, markMovieUnwatched, removeMovie, restoreMovie, fillMovieMeta } = useApp()
  const [query, setQuery] = useState('')
  const [undo, setUndo] = useState<{ text: string; revert: () => void } | null>(null)

  /** Même règle que partout : à droite c'est vu, à gauche on le sort de la liste. */
  const swipe = (m: WatchedMovie) => ({
    right:
      m.status === 'later' && !notYetReleased(m)
        ? {
            label: 'Vu',
            onSwipe: () => {
              markMovieWatched(m.movie_id, today())
              setUndo({ text: `${m.title} — vu.`, revert: () => markMovieUnwatched(m.movie_id) })
            },
          }
        : undefined,
    left: {
      label: 'Retirer',
      onSwipe: () => {
        removeMovie(m.movie_id)
        setUndo({ text: `${m.title} — retiré.`, revert: () => restoreMovie(m) })
      },
    },
  })

  // Les films « à voir » ajoutés avant ce champ n'ont pas de date de sortie
  // connue : on la relève une fois, tranquillement, pour savoir s'ils sont
  // déjà sortis ou non (sans quoi « Vu » se propose même sur un film pas
  // encore sorti).
  useEffect(() => {
    const missing = movies.filter((m) => m.status === 'later' && !m.release_date)
    missing.forEach((m) => {
      movieDetails(m.movie_id)
        .then((d) => {
          if (d?.releaseDate) fillMovieMeta(m.movie_id, { release_date: d.releaseDate })
        })
        .catch(() => {
          /* pas de date relevable : on retentera à la prochaine visite */
        })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movies.filter((m) => m.status === 'later' && !m.release_date).map((m) => m.movie_id).join(',')])

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
  // Le tri à l'affichage, plutôt que se fier à l'ordre de la liste chargée :
  // corriger une date après coup (édition, « à sa sortie »…) ne la retrie pas
  // dans l'état en mémoire. Sans date connue, en dernier plutôt qu'en tête.
  const watched = movies
    .filter((m) => m.status === 'watched' && matches(m.title))
    .sort((a, b) => {
      if (a.watched_at && b.watched_at) return b.watched_at.localeCompare(a.watched_at)
      if (a.watched_at) return -1
      if (b.watched_at) return 1
      return a.title.localeCompare(b.title, 'fr')
    })

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
          <SwipeRow key={m.movie_id} {...swipe(m)}>
            <a href={href.movie(m.movie_id)} className="row__link">
              <Poster src={m.poster_url} alt={m.title} />
              <div className="row__body">
                <h3>{m.title}</h3>
                <p className="muted">
                  {notYetReleased(m)
                    ? `Sort le ${formatShortDate(m.release_date!)}`
                    : (m.release_year ?? 'Année inconnue')}
                </p>
              </div>
            </a>
            <div className="row__actions">
              {!notYetReleased(m) && (
                <button className="btn btn--seen" onClick={() => markMovieWatched(m.movie_id, today())}>
                  Vu
                </button>
              )}
              <button
                className="link-btn muted row__drop"
                onClick={() => confirm(`Retirer ${m.title} de tes films à voir ?`) && removeMovie(m.movie_id)}
              >
                Retirer
              </button>
            </div>
          </SwipeRow>
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
          <SwipeRow key={m.movie_id} {...swipe(m)}>
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
                onClick={() =>
                  confirm(`Marquer ${m.title} comme pas vu ? Sa date de visionnage sera perdue.`) &&
                  markMovieUnwatched(m.movie_id)
                }
                title="Remet le film dans « à voir » (sans le supprimer), sa date de visionnage est perdue"
              >
                Pas vu
              </button>
              <button
                className="link-btn muted"
                onClick={() =>
                  confirm(`Retirer ${m.title} de tes films ? Contrairement à « Pas vu », la fiche est supprimée pour de bon.`) &&
                  removeMovie(m.movie_id)
                }
                title="Supprime le film de ta liste (contrairement à « Pas vu », qui le garde en « à voir »)"
              >
                Retirer
              </button>
            </div>
          </SwipeRow>
        ))}
      </ul>

      {movies.length > 0 && (
        <p className="muted swipe__hint">
          Sur téléphone : glisse vers la droite pour marquer vu, vers la gauche pour retirer.
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
                undo.revert()
                setUndo(null)
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
