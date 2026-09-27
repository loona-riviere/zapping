import { useState } from 'react'
import { notify } from '../lib/notify'
import { formatShortDate } from '../lib/progress'
import { nameOf, type Profile } from '../lib/social'
import { useSocial } from '../lib/socialState'
import { shareMovieViewing, type WatchedMovie } from '../lib/store'
import { ActionButton } from './ActionBar'
import { Sheet } from './Sheet'

/**
 * « 👫 À deux » sur un film vu : le marque vu chez un ami aussi, à la même
 * date. S'il l'avait déjà vu un autre jour, ce visionnage s'ajoute aux siens.
 */
export function WatchedTogether({ movie }: { movie: WatchedMovie }) {
  const { socialReady, profile, friends } = useSocial()
  const [open, setOpen] = useState(false)
  const [friendId, setFriendId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!socialReady || !profile || !friends.length) return null

  const friend: Profile | undefined = friends.find((f) => f.user_id === friendId) ?? (friends.length === 1 ? friends[0] : undefined)
  const when = movie.watched_at ? `le ${formatShortDate(movie.watched_at)}` : 'sans date'
  const close = () => {
    setOpen(false)
    setDone(null)
    setError(null)
  }

  return (
    <>
      <ActionButton icon="👫" label="À deux" onClick={() => setOpen(true)} />
      {open && (
        <Sheet title={`${movie.title}, à deux`} onClose={close}>
          {done ? (
            <>
              <p className="together__done">✓ Marqué vu chez {done} aussi.</p>
              <button className="btn btn--ghost sheet__cta" onClick={close}>Fermer</button>
            </>
          ) : (
            <>
              {friends.length > 1 && (
                <section className="sheet__section">
                  <p className="sheet__label">Vu avec</p>
                  <div className="chips">
                    {friends.map((f) => (
                      <button
                        key={f.user_id}
                        className={`pill${friend?.user_id === f.user_id ? ' pill--on' : ''}`}
                        onClick={() => setFriendId(f.user_id)}
                      >
                        {nameOf(f)}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              <button
                className="btn btn--primary sheet__cta"
                disabled={!friend || busy}
                onClick={async () => {
                  if (!friend) return
                  setBusy(true)
                  setError(null)
                  try {
                    await shareMovieViewing(friend.user_id, movie)
                    notify({ event: 'movie_together', to: friend.user_id, movieId: movie.movie_id })
                    setDone(nameOf(friend))
                  } catch (e) {
                    setError((e as Error).message)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {friend ? `Marquer vu chez ${nameOf(friend)} aussi` : 'Choisis avec qui'}
              </button>
              <p className="muted together__note">À ta date ({when}). S'il l'avait déjà vu, ce visionnage s'ajoute aux siens.</p>
              {error && <p className="error">Impossible : {error}</p>}
            </>
          )}
        </Sheet>
      )}
    </>
  )
}
