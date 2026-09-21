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
  const { movies, markMovieWatched, markMovieUnwatched, removeMovie, fillMovieMeta } = useApp()
  const [details, setDetails] = useState<MovieDetails | null>(null)
  const movie = movies.find((m) => m.movie_id === id)

  useEffect(() => {
    let alive = true
    setDetails(null)
    movieDetails(id)
      .then((d) => alive && setDetails(d))
      .catch(() => {
        /* pas de fiche dispo : on affiche juste ce qu'on a déjà */
      })
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

  if (!movie) {
    return <p className="error pad">Film introuvable dans ta liste. <a href={href.movies}>Retour</a></p>
  }

  return (
    <article className="show">
      <header className="show__head">
        <Poster src={movie.poster_url} alt={movie.title} size="lg" />
        <div className="show__meta">
          <h1>{movie.title}</h1>
          <p className="muted">
            {[movie.release_year, movie.runtime ? fmtRuntime(movie.runtime) : null, details?.genres.join(', ')]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {movie.status === 'watched' ? (
            <p className="show__count eplist__date--edit">
              Vu le{' '}
              <input
                type="date"
                value={movie.watched_at ? movie.watched_at.slice(0, 10) : ''}
                max={today()}
                onChange={(e) => e.target.value && markMovieWatched(movie.movie_id, `${e.target.value}T12:00:00.000Z`)}
              />
            </p>
          ) : (
            <p className="show__count muted">À voir</p>
          )}
          {movie.status === 'watched' ? (
            <button className="btn btn--ghost" onClick={() => markMovieUnwatched(movie.movie_id)}>
              Pas vu
            </button>
          ) : (
            <button className="btn btn--primary" onClick={() => markMovieWatched(movie.movie_id, today())}>
              Vu
            </button>
          )}
          <button
            className="link-btn muted"
            onClick={() => confirm(`Retirer ${movie.title} de tes films ?`) && removeMovie(movie.movie_id)}
          >
            Retirer
          </button>
        </div>
      </header>

      {details?.overview && <p className="show__summary">{details.overview}</p>}
    </article>
  )
}
