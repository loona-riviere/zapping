import { useState, type ReactNode } from 'react'

/**
 * Garde une longue liste courte : les `limit` premiers, puis « Voir plus »
 * (tout le reste d'un coup) et « Voir moins ». `all` montre tout (recherche).
 * Un composant plutôt qu'un hook : utilisable après les retours anticipés
 * d'un écran.
 */
export function Limited<T>({
  items,
  limit,
  all = false,
  children,
}: {
  items: T[]
  limit: number
  all?: boolean
  children: (visible: T[]) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const long = !all && items.length > limit + 2
  return (
    <>
      {children(long && !open ? items.slice(0, limit) : items)}
      {long && (
        <button type="button" className="show-more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'Voir moins' : `Voir plus (${items.length - limit})`}
        </button>
      )}
    </>
  )
}
