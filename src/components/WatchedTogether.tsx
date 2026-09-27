import { useState } from 'react'
import { notify } from '../lib/notify'
import { nameOf } from '../lib/social'
import { useSocial } from '../lib/socialState'
import { shareMovieViewing, type WatchedMovie } from '../lib/store'
import { formatShortDate } from '../lib/progress'

/**
 * « 👫 Vu ensemble » sur un film vu : le marque vu chez un ami aussi, à la
 * même date. S'il l'avait déjà vu un autre jour, ce visionnage s'ajoute aux
 * siens.
 */
export function WatchedTogether({ movie }: { movie: WatchedMovie }) {
  const { socialReady, profile, friends } = useSocial()
  const [picking, setPicking] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!socialReady || !profile || !friends.length) return null
  if (done) return <p className="muted rec__sent">👫 Marqué vu pour {done} aussi.</p>
  if (!picking) {
    return (
      <button type="button" className="pill" onClick={() => setPicking(true)}>
        👫 Vu ensemble
      </button>
    )
  }
  const when = movie.watched_at ? `le ${formatShortDate(movie.watched_at)}` : 'sans date'
  return (
    <div className="duo">
      <p>Avec qui as-tu vu {movie.title} ({when}) ? Il sera marqué vu chez lui aussi.</p>
      <div className="duo__friends">
        {friends.map((f) => (
          <button
            key={f.user_id}
            className="btn btn--ghost"
            onClick={async () => {
              setError(null)
              try {
                await shareMovieViewing(f.user_id, movie)
                notify({ event: 'movie_together', to: f.user_id, movieId: movie.movie_id })
                setDone(nameOf(f))
              } catch (e) {
                setError((e as Error).message)
              }
            }}
          >
            {nameOf(f)}
          </button>
        ))}
        <button className="link-btn muted" onClick={() => setPicking(false)}>Annuler</button>
      </div>
      {error && <p className="error">Impossible : {error}</p>}
    </div>
  )
}
