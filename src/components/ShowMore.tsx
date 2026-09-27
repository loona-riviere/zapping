import { useState, type ReactNode } from 'react'

/**
 * Garde une longue liste courte : les `limit` premiers, puis « Voir plus »
 * (tout le reste d'un coup) et « Voir moins ». `all` montre tout (recherche).
 * Un composant plutôt qu'un hook : utilisable après les retours anticipés
 * d'un écran.
 */
export function Limited<T>({
  id,
  items,
  limit,
  all = false,
  children,
}: {
  /** Pour se souvenir de « Voir plus » ouvert en revenant sur l'écran. */
  id: string
  items: T[]
  limit: number
  all?: boolean
  children: (visible: T[]) => ReactNode
}) {
  const key = `zapping.more.${id}`
  const [open, setOpenState] = useState(() => {
    try {
      return sessionStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const setOpen = (f: (v: boolean) => boolean) =>
    setOpenState((v) => {
      const next = f(v)
      try {
        sessionStorage.setItem(key, next ? '1' : '0')
      } catch {
        /* rien */
      }
      return next
    })
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
