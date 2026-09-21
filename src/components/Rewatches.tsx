import { useApp } from '../lib/appState'

/**
 * Compteur de revisionnages. Une série vue trois fois en entier porte 2 :
 * on compte les fois où on l'a reprise, pas les visionnages au total, pour que
 * zéro veuille dire « vue une fois » sans piéger personne.
 */
export function Rewatches({ showId }: { showId: number }) {
  const { rewatchesOf, setRewatches } = useApp()
  const n = rewatchesOf(showId)
  const total = n + 1

  return (
    <p className="rewatch">
      <span className="rewatch__label">
        Vue <strong>{total}</strong> fois
      </span>
      <span className="rewatch__buttons">
        <button
          className="rewatch__btn"
          onClick={() => setRewatches(showId, n - 1)}
          disabled={n === 0}
          aria-label="Retirer un visionnage"
        >
          −
        </button>
        <button
          className="rewatch__btn"
          onClick={() => setRewatches(showId, n + 1)}
          aria-label="Ajouter un visionnage"
        >
          +
        </button>
      </span>
    </p>
  )
}
