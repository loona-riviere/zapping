import { useState, type ReactNode } from 'react'
import type { Rating } from '../lib/store'
import { Sheet } from './Sheet'

/**
 * La rangée d'actions d'une fiche, façon Apple TV / Letterboxd : des boutons
 * de même taille, icône au-dessus, libellé dessous, alignés sur une grille.
 * Chacun ouvre sa feuille du bas ; rien d'autre ne traîne sur la fiche.
 */
export function ActionBar({ children }: { children: ReactNode }) {
  return <div className="actionbar">{children}</div>
}

export function ActionButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className={`action${active ? ' action--on' : ''}`} onClick={onClick}>
      <span className="action__icon" aria-hidden="true">{icon}</span>
      <span className="action__label">{label}</span>
    </button>
  )
}

/** Choisir parmi quelques options (statut…), la courante cochée. */
export function ChoiceAction<T extends string>({
  title,
  value,
  options,
  onChange,
}: {
  title: string
  value: T
  options: { value: T; icon: string; label: string; hint?: string }[]
  onChange: (v: T) => void
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value) ?? options[0]
  return (
    <>
      <ActionButton icon={current.icon} label={current.label} onClick={() => setOpen(true)} />
      {open && (
        <Sheet title={title} onClose={() => setOpen(false)}>
          <ul className="choices">
            {options.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  className={`choice${o.value === value ? ' choice--on' : ''}`}
                  onClick={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                >
                  <span className="choice__icon" aria-hidden="true">{o.icon}</span>
                  <span className="choice__text">
                    {o.label}
                    {o.hint && <span className="choice__hint">{o.hint}</span>}
                  </span>
                  {o.value === value && <span className="choice__check" aria-hidden="true">✓</span>}
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </>
  )
}

const RATINGS: { value: Rating; icon: string; label: string }[] = [
  { value: 'love', icon: '❤️', label: "J'adore" },
  { value: 'like', icon: '👍', label: "J'aime" },
  { value: 'meh', icon: '😐', label: 'Bof' },
  { value: 'dislike', icon: '👎', label: "Je n'aime pas" },
]

/** « Noter » : quatre choix façon Netflix ; rechoisir la note active l'efface. */
export function RatingAction({ rating, onChange }: { rating: Rating | null; onChange: (r: Rating | null) => void }) {
  const [open, setOpen] = useState(false)
  const current = RATINGS.find((r) => r.value === rating)
  return (
    <>
      <ActionButton icon={current?.icon ?? '☆'} label={current?.label ?? 'Noter'} active={!!current} onClick={() => setOpen(true)} />
      {open && (
        <Sheet title="Ta note" onClose={() => setOpen(false)}>
          <div className="rating-big">
            {RATINGS.map((r) => (
              <button
                key={r.value}
                type="button"
                className={`rating-big__btn${rating === r.value ? ' rating-big__btn--on' : ''}`}
                aria-pressed={rating === r.value}
                onClick={() => {
                  onChange(rating === r.value ? null : r.value)
                  setOpen(false)
                }}
              >
                <span aria-hidden="true">{r.icon}</span>
                {r.label}
              </button>
            ))}
          </div>
          {rating && (
            <button
              type="button"
              className="btn btn--ghost sheet__cta"
              onClick={() => {
                onChange(null)
                setOpen(false)
              }}
            >
              Retirer la note
            </button>
          )}
        </Sheet>
      )}
    </>
  )
}
