import type { Rating } from '../lib/store'

const OPTIONS: { value: Rating; icon: string; label: string }[] = [
  { value: 'dislike', icon: '👎', label: "Je n'aime pas" },
  { value: 'like', icon: '👍', label: "J'aime" },
  { value: 'love', icon: '❤️', label: "J'adore" },
]

/** Un deuxième clic sur la note active l'efface, comme sur Netflix. */
export function RatingPicker({ rating, onChange }: { rating: Rating | null; onChange: (r: Rating | null) => void }) {
  return (
    <div className="rating-picker" role="group" aria-label="Note">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`rating-picker__btn${rating === o.value ? ' rating-picker__btn--active' : ''}`}
          aria-pressed={rating === o.value}
          title={o.label}
          onClick={() => onChange(rating === o.value ? null : o.value)}
        >
          {o.icon}
        </button>
      ))}
    </div>
  )
}
