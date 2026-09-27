/** Lignes grises animées en attendant une liste (affiche + titre + texte). */
export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <ul className="rows" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="row">
          <div className="row__link">
            <span className="skeleton skeleton--poster" />
            <div className="row__body">
              <span className="skeleton skeleton--title" />
              <span className="skeleton skeleton--text" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Une fiche en attente : grande affiche, titre, lignes, rangée de boutons. */
export function SkeletonPage() {
  return (
    <div className="skeleton-page" aria-busy="true" aria-label="Chargement">
      <div className="show__head">
        <span className="skeleton skeleton--poster-lg" />
        <div className="skeleton-page__meta">
          <span className="skeleton skeleton--h1" />
          <span className="skeleton skeleton--text" />
          <span className="skeleton skeleton--text skeleton--short" />
        </div>
      </div>
      <div className="skeleton-page__actions">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="skeleton skeleton--action" />
        ))}
      </div>
      <span className="skeleton skeleton--block" />
      <span className="skeleton skeleton--text" />
      <span className="skeleton skeleton--text" />
      <span className="skeleton skeleton--text skeleton--short" />
    </div>
  )
}

/** Une rangée d'affiches qui défile, en attente. */
export function SkeletonShelf({ count = 5 }: { count?: number }) {
  return (
    <ul className="shelf shelf--carousel" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="shelf__item">
          <span className="skeleton skeleton--poster-fill" />
        </li>
      ))}
    </ul>
  )
}
