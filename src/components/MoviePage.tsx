import { useEffect, useState } from 'react'
import { useApp } from '../lib/appState'
import { formatShortDate } from '../lib/progress'
import { href } from '../lib/route'
import { movieDetails, type MovieDetails } from '../lib/tmdb'
import { DateField, History } from './History'
import { Comments } from './Comments'
import { Poster } from './Poster'
import { ActionBar, ActionButton, RatingAction } from './ActionBar'
import { RecommendButton } from './Recommend'
import { Summary } from './Summary'
import { WatchedTogether } from './WatchedTogether'
import { WhereToWatch } from './WhereToWatch'

const today = () => new Date().toISOString().slice(0, 10)

const fmtRuntime = (min: number) => {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`
}

export function MoviePage({ id }: { id: number }) {
  const { movies, addMovies, addToWatchlist, markMovieWatched, markMovieUnwatched, rewatchMovie, removePastView, setMovieViews, removeMovie, fillMovieMeta, rateMovie } =
    useApp()
  const [details, setDetails] = useState<MovieDetails | null>(null)
  const [error, setError] = useState(false)
  const [editViews, setEditViews] = useState(false)
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
            <p className="show__count">
              {movie.watched_at ? `Vu le ${formatShortDate(movie.watched_at)}` : 'Vu'}
              {(movie.past_views ?? []).length > 0 && <span className="muted"> · {1 + (movie.past_views ?? []).length} fois</span>}
            </p>
          ) : (
            <p className="show__count muted">
              {notYetReleased ? `Sort le ${formatShortDate(releaseDate!)}` : 'À voir'}
            </p>
          )}
        </div>
      </header>

      <div className="show__controls">
        {!movie && asMovie && (
          <div className="movie__actions">
            {!notYetReleased && (
              <button className="btn btn--primary" onClick={() => addMovies([{ movie: asMovie, watchedAt: today() }])}>
                Vu
              </button>
            )}
            <button className="btn btn--ghost" onClick={() => addToWatchlist(asMovie)}>
              À voir
            </button>
          </div>
        )}

        <ActionBar>
          {movie && (movie.status === 'watched' || !notYetReleased) && (
            <ActionButton
              icon={movie.status === 'watched' ? '✓' : '👁️'}
              label={movie.status === 'watched' ? 'Vu' : 'Marquer vu'}
              active={movie.status === 'watched'}
              onClick={() =>
                movie.status === 'watched'
                  ? confirm(
                      movie.past_views?.length
                        ? `Retirer le visionnage du ${movie.watched_at ? formatShortDate(movie.watched_at) : 'jour inconnu'} ? Les précédents restent.`
                        : `Marquer ${title} comme pas vu ? Sa date de visionnage sera perdue.`,
                    ) && markMovieUnwatched(movie.movie_id)
                  : markMovieWatched(movie.movie_id, today())
              }
            />
          )}
          {movie?.status === 'watched' && <RatingAction rating={movie.rating} onChange={(r) => rateMovie(movie.movie_id, r)} />}
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
        </ActionBar>

        {movie?.status === 'watched' && (
          <History
            title="Visionnages"
            actions={
              <button type="button" className="pill pill--small" onClick={() => rewatchMovie(movie.movie_id, `${today()}T12:00:00.000Z`)}>
                🔁 Revu
              </button>
            }
            editing={editViews}
            onToggle={() => setEditViews((v) => !v)}
            entries={[
              {
                key: 'now',
                icon: '✓',
                text: movie.watched_at ? `Vu le ${formatShortDate(movie.watched_at)}` : 'Vu, date inconnue',
                edit: (
                  <span className="hist__dates">
                    <DateField label="Vu le" value={movie.watched_at} onChange={(v) => markMovieWatched(movie.movie_id, v)} />
                    {details?.releaseDate && !movie.watched_at?.startsWith(details.releaseDate) && (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => markMovieWatched(movie.movie_id, `${details.releaseDate}T12:00:00.000Z`)}
                      >
                        À sa sortie
                      </button>
                    )}
                  </span>
                ),
              },
              ...(movie.past_views ?? [])
                .map((at, i) => ({ at, i }))
                .reverse()
                .map(({ at, i }) => ({
                  key: `past-${i}`,
                  icon: '✓',
                  text: at ? `Vu le ${formatShortDate(at)}` : 'Vu, date inconnue',
                  edit: (
                    <DateField
                      label="Vu le"
                      value={at}
                      onChange={(v) =>
                        setMovieViews(movie.movie_id, movie.watched_at, (movie.past_views ?? []).map((x, j) => (j === i ? v : x)))
                      }
                    />
                  ),
                  onRemove: () => confirm('Supprimer ce visionnage ?') && removePastView(movie.movie_id, i),
                })),
            ]}
            extra={
              <DateField
                label="Ajouter un visionnage le"
                value={null}
                onChange={(v) => {
                  if (!v) return
                  const past = [...(movie.past_views ?? []), v].sort((a, b) => (a ?? '').localeCompare(b ?? ''))
                  setMovieViews(movie.movie_id, movie.watched_at, past)
                }}
              />
            }
          />
        )}

      </div>

      <WhereToWatch movieId={id} title={title} />

      {details?.overview && <Summary text={details.overview} />}

      <Comments kind="movie" itemId={String(id)} title={title} seen={movie?.status === 'watched'} />

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
