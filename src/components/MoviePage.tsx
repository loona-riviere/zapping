import { useEffect, useState } from 'react'
import { useApp } from '../lib/appState'
import { href } from '../lib/route'
import { movieDetails, type MovieDetails } from '../lib/tmdb'
import { Poster } from './Poster'

const today = () => new Date().toISOString().slice(0, 10)

const fmtRuntime = (min: number) => {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`
}

export function MoviePage({ id }: { id: number }) {
  const { movies, addMovies, addToWatchlist, markMovieWatched, markMovieUnwatched, removeMovie, fillMovieMeta } =
    useApp()
  const [details, setDetails] = useState<MovieDetails | null>(null)
  const [error, setError] = useState(false)
  const movie = movies.find((m) => m.movie_id === id)

  useEffect(() => {
    let alive = true
    setDetails(null)
    setError(false)
    movieDetails(id)
      .then((d) => alive && (d ? setDetails(d) : setError(true)))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [id])

  // Affiche et/ou durée manquantes (film ajouté sans passer par l'app) :
  // on les complète tranquillement dès que la fiche TMDB a répondu.
  useEffect(() => {
    if (!details || !movie) return
    const patch: { poster_url?: string; runtime?: number } = {}
    if (!movie.poster_url && details.posterUrl) patch.poster_url = details.posterUrl
    if (!movie.runtime && details.runtime) patch.runtime = details.runtime
    if (Object.keys(patch).length) fillMovieMeta(movie.movie_id, patch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details, movie?.movie_id, movie?.poster_url, movie?.runtime])

  if (error) {
    return <p className="error pad">Impossible de charger ce film depuis TMDB. <a href={href.search}>Retour</a></p>
  }
  if (!movie && !details) return <p className="muted pad">Chargement…</p>

  // Un film déjà suivi a la main sur son propre titre/affiche/année (peuvent
  // avoir été corrigés à la main) ; sinon, tout vient de TMDB — c'est le cas
  // d'un film ouvert depuis un résultat de recherche, pas encore ajouté.
  const title = movie?.title ?? details!.title
  const posterUrl = movie?.poster_url ?? details?.posterUrl ?? null
  const year = movie?.release_year ?? details?.year ?? null
  const runtime = movie?.runtime ?? details?.runtime ?? null
  const asMovie = details && { id, title, poster_url: posterUrl, year, overview: details.overview }

  return (
    <article className="show">
      <header className="show__head">
        <Poster src={posterUrl} alt={title} size="lg" />
        <div className="show__meta">
          <h1>{title}</h1>
          <p className="muted">
            {[year, runtime ? fmtRuntime(runtime) : null, details?.genres.join(', ')].filter(Boolean).join(' · ')}
          </p>

          {movie?.status === 'watched' ? (
            <p className="show__count eplist__date--edit">
              Vu le{' '}
              <input
                type="date"
                value={movie.watched_at ? movie.watched_at.slice(0, 10) : ''}
                max={today()}
                onChange={(e) => e.target.value && markMovieWatched(movie.movie_id, `${e.target.value}T12:00:00.000Z`)}
              />
              {details?.releaseDate && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => markMovieWatched(movie.movie_id, `${details.releaseDate}T12:00:00.000Z`)}
                  title="Reprend la date de sortie du film"
                >
                  à sa sortie
                </button>
              )}
            </p>
          ) : (
            <p className="show__count muted">À voir</p>
          )}

          {movie?.status === 'watched' ? (
            <button
              className="btn btn--ghost"
              onClick={() =>
                confirm(`Marquer ${title} comme pas vu ? Sa date de visionnage sera perdue.`) &&
                markMovieUnwatched(movie.movie_id)
              }
            >
              Pas vu
            </button>
          ) : movie ? (
            <button className="btn btn--primary" onClick={() => markMovieWatched(movie.movie_id, today())}>
              Vu
            </button>
          ) : (
            asMovie && (
              <>
                <button className="btn btn--primary" onClick={() => addMovies([{ movie: asMovie, watchedAt: today() }])}>
                  Vu
                </button>
                <button className="btn btn--ghost" onClick={() => addToWatchlist(asMovie)}>
                  À voir
                </button>
              </>
            )
          )}

          {movie && (
            <button
              className="link-btn muted"
              onClick={() =>
                confirm(
                  `Retirer ${title} de tes films ? Contrairement à « Pas vu », la fiche est supprimée pour de bon.`,
                ) && removeMovie(movie.movie_id)
              }
            >
              Retirer
            </button>
          )}
        </div>
      </header>

      {details?.overview && <p className="show__summary">{details.overview}</p>}
    </article>
  )
}
