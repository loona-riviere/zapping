import type { ReactNode } from 'react'

/**
 * Le bouton « ⋯ » d'une fiche : les actions rares (recommander, cacher aux
 * amis, retirer) y sont rangées pour que la fiche ne montre que l'essentiel.
 */
export function MoreButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`more-btn${open ? ' more-btn--on' : ''}`}
      onClick={onToggle}
      aria-expanded={open}
      aria-label="Plus d'actions"
      title="Plus d'actions"
    >
      ⋯
    </button>
  )
}

export function MorePanel({ children }: { children: ReactNode }) {
  return <div className="more">{children}</div>
}
