import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type React from 'react'

type Drag = { id: string | number; startY: number; dy: number }

/**
 * Glisser-déposer d'une liste par sa poignée, au doigt comme à la souris.
 * L'ordre change en direct pendant le geste : la ligne tenue suit le doigt,
 * ses voisines lui cèdent la place dès qu'on dépasse leur milieu. Le nouvel
 * ordre n'est enregistré qu'au lâcher.
 */
export function useReorder<T extends string | number>(ids: T[], onCommit: (ordered: T[]) => void) {
  const [order, setOrder] = useState<T[]>(ids)
  const [drag, setDrag] = useState<Drag | null>(null)
  const rows = useRef(new Map<T, HTMLElement>())
  const orderRef = useRef(order)
  orderRef.current = order
  const dragRef = useRef<Drag | null>(null)
  const latest = useRef({ ids, onCommit })
  latest.current = { ids, onCommit }

  // Hors geste, la liste suit ce que l'app lui donne (ajout, retrait, autre appareil).
  const key = ids.join('|')
  useEffect(() => {
    if (!dragRef.current) setOrder(ids)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const update = (d: Drag | null) => {
    dragRef.current = d
    setDrag(d)
  }

  function move(clientY: number) {
    const d = dragRef.current
    if (!d) return
    let dy = clientY - d.startY
    let startY = d.startY
    const current = [...orderRef.current]
    let i = current.indexOf(d.id as T)
    // Plusieurs échanges possibles en un seul mouvement rapide.
    for (;;) {
      const below = current[i + 1]
      const above = current[i - 1]
      const hBelow = below !== undefined ? rows.current.get(below)?.offsetHeight ?? 0 : 0
      const hAbove = above !== undefined ? rows.current.get(above)?.offsetHeight ?? 0 : 0
      if (below !== undefined && dy > hBelow / 2) {
        ;[current[i], current[i + 1]] = [current[i + 1], current[i]]
        i++
        dy -= hBelow
        startY += hBelow
      } else if (above !== undefined && dy < -hAbove / 2) {
        ;[current[i], current[i - 1]] = [current[i - 1], current[i]]
        i--
        dy += hAbove
        startY -= hAbove
      } else break
    }
    if (current.join('|') !== orderRef.current.join('|')) {
      orderRef.current = current
      setOrder(current)
    }
    update({ ...d, startY, dy })
  }

  function onPointerDown(id: T, e: ReactPointerEvent) {
    e.stopPropagation() // pas de glisser gauche/droite de la ligne en même temps
    e.preventDefault()
    update({ id, startY: e.clientY, dy: 0 })
    // Suivi sur toute la fenêtre : quand la ligne change de place dans la
    // liste, le navigateur perd la capture du pointeur posée sur la poignée.
    const onMove = (ev: PointerEvent) => {
      ev.preventDefault()
      move(ev.clientY)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      update(null)
      const { ids: current, onCommit: commit } = latest.current
      if (orderRef.current.join('|') !== current.join('|')) commit(orderRef.current)
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return {
    order,
    /** À poser sur la ligne (`ref` et `style`) pour qu'elle suive le doigt. */
    rowProps: (id: T) => ({
      ref: (el: HTMLElement | null) => {
        if (el) rows.current.set(id, el)
        else rows.current.delete(id)
      },
      style: (drag?.id === id
        ? { transform: `translateY(${drag.dy}px)`, zIndex: 2, position: 'relative', boxShadow: '0 8px 24px rgb(0 0 0 / .25)' }
        : undefined) as CSSProperties | undefined,
    }),
    handleProps: (id: T) => ({
      onPointerDown: (e: ReactPointerEvent) => onPointerDown(id, e),
    }),
  }
}

/** La poignée « ⠿ » : seule zone qui déplace la ligne, pour ne gêner ni le défilement ni le glisser. */
export function DragHandle(props: ReturnType<ReturnType<typeof useReorder>['handleProps']> & { label: string }) {
  const { label, ...handlers } = props
  return (
    <button type="button" className="drag-handle" aria-label={`Déplacer ${label}`} title="Glisser pour ranger" {...handlers}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <circle cx="9" cy="6" r="1.7" /><circle cx="15" cy="6" r="1.7" />
        <circle cx="9" cy="12" r="1.7" /><circle cx="15" cy="12" r="1.7" />
        <circle cx="9" cy="18" r="1.7" /><circle cx="15" cy="18" r="1.7" />
      </svg>
    </button>
  )
}

/**
 * Liste d'envie rangeable : rend chaque élément dans l'ordre courant, avec
 * de quoi suivre le doigt (`row`) et la poignée (`handle`). Composant à part
 * pour que le hook vive à côté de la liste, même dans un écran qui a des
 * retours anticipés. `enabled` à faux (recherche en cours…) masque la
 * poignée : ranger une liste filtrée mélangerait les rangs des éléments cachés.
 */
export function WishRows<T, K extends string | number>({
  items,
  idOf,
  onCommit,
  enabled = true,
  render,
}: {
  items: T[]
  idOf: (t: T) => K
  onCommit: (ordered: K[]) => void
  enabled?: boolean
  render: (
    item: T,
    row: { rowRef: (el: HTMLElement | null) => void; style: CSSProperties | undefined },
    handle: ReturnType<ReturnType<typeof useReorder<K>>['handleProps']> | null,
  ) => React.ReactNode
}) {
  const ids = items.map(idOf)
  const { order, rowProps, handleProps } = useReorder<K>(ids, onCommit)
  const byId = new Map(items.map((t) => [idOf(t), t]))
  return (
    <ul className="rows">
      {order.map((id) => {
        const item = byId.get(id)
        if (!item) return null
        const { ref, style } = rowProps(id)
        return render(item, { rowRef: ref, style }, enabled && items.length > 1 ? handleProps(id) : null)
      })}
    </ul>
  )
}
