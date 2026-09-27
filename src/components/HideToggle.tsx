import { useState } from 'react'
import { setHidden } from '../lib/social'
import { useSocial } from '../lib/socialState'

type Target =
  | { table: 'tracked_shows'; column: 'show_id'; id: number }
  | { table: 'watched_movies'; column: 'movie_id'; id: number }
  | { table: 'tracked_books'; column: 'book_id'; id: string }

/**
 * « Caché à mes amis » sur une fiche : les plaisirs coupables restent entre
 * soi et soi. N'apparaît qu'une fois les amis installés et un pseudo choisi.
 */
export function HideToggle({ target, hidden, onChange }: { target: Target; hidden: boolean; onChange: (h: boolean) => void }) {
  const { socialReady, profile } = useSocial()
  const [busy, setBusy] = useState(false)
  if (!socialReady || !profile) return null
  return (
    <label className="hide-toggle">
      <input
        type="checkbox"
        checked={hidden}
        disabled={busy}
        onChange={async (e) => {
          const next = e.target.checked
          setBusy(true)
          onChange(next)
          try {
            await setHidden(target.table, target.column, target.id, next)
          } catch {
            onChange(!next)
          } finally {
            setBusy(false)
          }
        }}
      />
      🙈 Caché à mes amis
    </label>
  )
}
