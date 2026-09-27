import { useEffect, useState } from 'react'
import { useApp } from '../lib/appState'
import { formatShortDate } from '../lib/progress'
import { href } from '../lib/route'
import { movieDetails, type MovieDetails } from '../lib/tmdb'
import { Poster } from './Poster'
import { RecommendButton } from './Recommend'
import { RatingPicker } from './RatingPicker'
import { WatchedTogether } from './WatchedTogether'
import { WhereToWatch } from './WhereToWatch'

const today = () => new Date().toISOString().slice(0, 10)

const fmtRuntime = (min: number) => {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`
}

export function MoviePage({ id }: { id: number }) {
  const { movies, addMovies, addToWatchlist, markMovieWatched, markMovieUnwatched, rewatchMovie, removePastView, removeMovie, fillMovieMeta, rateMovie } =
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

  // Affiche, durée et/ou date de sortie manquantes (film ajouté sans passer
  // par l'app, ou avant l'ajout de ce champ) : on les complète tranquillement
  // dès que la fiche TMDB a répondu.
  useEffect(() => {
    if (!details || !movie) return
    const patch: { poster_url?: string; runtime?: number; release_date?: string } = {}
    if (!movie.poster_url && details.posterUrl) patch.poster_url = details.posterUrl
    if (!movie.runtime && details.runtime) patch.runtime = details.runtime
    if (!movie.release_date && details.releaseDate) patch.release_date = details.releaseDate
    if (Object.keys(patch).length) fillMovieMeta(movie.movie_id, patch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details, movie?.movie_id, movie?.poster_url, movie?.runtime, movie?.release_date])

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
  const releaseDate = movie?.release_date ?? details?.releaseDate ?? null
  // Une date connue et future : le film n'est pas encore sorti, inutile de
  // proposer de le marquer vu. Sans date connue, on ne bloque rien.
  const notYetReleased = !!releaseDate && releaseDate > today()
  const asMovie = details && {
    id,
    title,
    poster_url: posterUrl,
    year,
    release_date: details.releaseDate,
    overview: details.overview,
  }

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
            <>
              <p className="show__count eplist__date--edit">
                Vu le
                <input
                  type="date"
                  value={movie.watched_at ? movie.watched_at.slice(0, 10) : ''}
                  max={today()}
                  onChange={(e) => e.target.value && markMovieWatched(movie.movie_id, `${e.target.value}T12:00:00.000Z`)}
                />
              </p>
              {(movie.past_views ?? []).length > 0 && (
                <p className="muted past-views">
                  Aussi vu{' '}
                  {(movie.past_views ?? []).map((at, i) => (
                    <span key={i} className="past-views__item">
                      {at ? `le ${formatShortDate(at)}` : 'une fois (date inconnue)'}
                      <button
                        type="button"
                        className="link-btn muted"
                        aria-label="Oublier ce visionnage"
                        onClick={() => confirm('Oublier ce visionnage ?') && removePastView(movie.movie_id, i)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </p>
              )}
            </>
          ) : (
            <p className="show__count muted">
              {notYetReleased ? `Sort le ${formatShortDate(releaseDate!)}` : 'À voir'}
            </p>
          )}
        </div>
      </header>

      <div className="show__controls">
        {movie?.status === 'watched' && (
          <RatingPicker rating={movie.rating} onChange={(r) => rateMovie(movie.movie_id, r)} />
        )}

        <div className="movie__actions">
          {movie?.status === 'watched' ? (
            <button
              className="btn btn--ghost"
              onClick={() =>
                confirm(
                  movie.past_views?.length
                    ? `Retirer le visionnage du ${movie.watched_at ? formatShortDate(movie.watched_at) : 'jour inconnu'} ? Les précédents restent.`
                    : `Marquer ${title} comme pas vu ? Sa date de visionnage sera perdue.`,
                ) && markMovieUnwatched(movie.movie_id)
              }
            >
              Pas vu
            </button>
          ) : movie ? (
            !notYetReleased && (
              <button className="btn btn--primary" onClick={() => markMovieWatched(movie.movie_id, today())}>
                Vu
              </button>
            )
          ) : (
            asMovie && (
              <>
                {!notYetReleased && (
                  <button
                    className="btn btn--primary"
                    onClick={() => addMovies([{ movie: asMovie, watchedAt: today() }])}
                  >
                    Vu
                  </button>
                )}
                <button className="btn btn--ghost" onClick={() => addToWatchlist(asMovie)}>
                  À voir
                </button>
              </>
            )
          )}
        </div>

        {movie?.status === 'watched' && details?.releaseDate && !movie.watched_at?.startsWith(details.releaseDate) && (
          <button
            type="button"
            className="link-btn muted show__untrack"
            onClick={() => markMovieWatched(movie.movie_id, `${details.releaseDate}T12:00:00.000Z`)}
          >
            Dater à sa sortie ({formatShortDate(details.releaseDate)})
          </button>
        )}

        <div className="pills">
          {movie?.status === 'watched' && (
            <button type="button" className="pill" onClick={() => rewatchMovie(movie.movie_id, `${today()}T12:00:00.000Z`)}>
              🔁 Revu
            </button>
          )}
          {movie?.status === 'watched' && <WatchedTogether movie={movie} />}
          <RecommendButton
            item={{
              kind: 'movie',
              itemId: String(id),
              title,
              image: posterUrl,
              meta: {
                kind: 'movie',
                movie: { id, title, poster_url: posterUrl, year, release_date: releaseDate, overview: details?.overview ?? null },
              },
            }}
          />
        </div>
      </div>

      {details?.overview && <p className="show__summary">{details.overview}</p>}

      {movie?.status !== 'watched' && <WhereToWatch movieId={id} title={title} />}

      {movie && (
        <button
          type="button"
          className="link-btn muted show__untrack"
          onClick={() =>
            confirm(`Retirer ${title} de tes films ? Contrairement à « Pas vu », la fiche est supprimée pour de bon.`) &&
            removeMovie(movie.movie_id)
          }
        >
          Retirer de mes films
        </button>
      )}
    </article>
  )
}
