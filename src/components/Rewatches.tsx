import { useApp } from '../lib/appState'
import { isAired } from '../lib/progress'
import type { TvEpisode, TvShow } from '../lib/tvmaze'

/**
 * Compteur de revisionnages et conduite d'une passe en cours.
 *
 * Une série vue trois fois porte 2 en base : on compte les reprises, pas les
 * visionnages, mais l'écran affiche « vue 3 fois » pour qu'il n'y ait rien à
 * interpréter.
 */
export function Rewatches({ show, episodes }: { show: TvShow; episodes: TvEpisode[] }) {
  const { rewatchesOf, setRewatches, isRewatching, startRewatch, endRewatch, watchedFor } = useApp()
  const n = rewatchesOf(show.id)
  const running = isRewatching(show.id)
  const seen = watchedFor(show.id)

  const aired = episodes.filter((e) => isAired(e))
  const done = aired.filter((e) => seen.has(e.id)).length
  const complete = aired.length > 0 && done === aired.length

  if (running) {
    return (
      <div className="rewatch rewatch--live">
        <p className="rewatch__state">
          <strong>Revisionnage en cours</strong> — {done} / {aired.length} épisodes
        </p>
        <div className="rewatch__actions">
          {complete ? (
            <button className="btn btn--primary" onClick={() => endRewatch(show.id, true)}>
              Terminer, ça fera {n + 2} fois
            </button>
          ) : (
            <button
              className="link-btn"
              onClick={() =>
                confirm(`Arrêter le revisionnage de ${show.name} ? La progression de cette passe sera perdue, pas l'historique.`) &&
                endRewatch(show.id, false)
              }
            >
              Arrêter
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="rewatch">
      <p className="rewatch__label">
        Vue <strong>{n + 1}</strong> fois
        <span className="rewatch__buttons">
          <button
            className="rewatch__btn"
            onClick={() => setRewatches(show.id, n - 1)}
            disabled={n === 0}
            aria-label="Retirer un visionnage"
          >
            −
          </button>
          <button
            className="rewatch__btn"
            onClick={() => setRewatches(show.id, n + 1)}
            aria-label="Ajouter un visionnage"
          >
            +
          </button>
        </span>
      </p>
      <button className="link-btn rewatch__start" onClick={() => startRewatch(show.id)}>
        Je la revois
      </button>
    </div>
  )
}
