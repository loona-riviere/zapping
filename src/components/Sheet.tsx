import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
/** Feuilles ouvertes, de la plus ancienne à celle du dessus. */
const openSheets: RefObject<HTMLDivElement>[] = []
/** Défilement de la page avant la première feuille, rendu à la fermeture de la dernière. */
let pageOverflow = ''

/**
 * Feuille qui monte du bas de l'écran, façon iOS : fond assombri, poignée,
 * fermeture par le fond, par « Fermer », par Échap ou en la tirant vers le
 * bas. Le contenu défile à l'intérieur ; la page derrière ne bouge pas.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; dy: number } | null>(null)

  // onClose change à chaque rendu du parent : on garde la dernière dans une
  // ref, pour que l'effet ne tourne qu'à l'ouverture. Sinon il relançait
  // focus() sur la feuille à chaque lettre tapée, et le clavier se fermait.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    // Au clavier, le focus reste dans la feuille, et revient à la fermeture
    // sur ce qui l'a ouverte. Échap et Tab ne concernent que la feuille du
    // dessus quand deux sont empilées.
    const opener = document.activeElement as HTMLElement | null
    if (!openSheets.length) {
      pageOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    openSheets.push(panel)
    const onKey = (e: KeyboardEvent) => {
      if (openSheets[openSheets.length - 1] !== panel) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
      } else if (e.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
        if (!items.length) return
        const first = items[0]
        const last = items[items.length - 1]
        const at = document.activeElement
        if (e.shiftKey && (at === first || at === panel.current)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && at === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    panel.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      openSheets.splice(openSheets.indexOf(panel), 1)
      if (!openSheets.length) document.body.style.overflow = pageOverflow
      // Pas de retour sur un champ de saisie : sur mobile, ça rouvrirait le clavier.
      if (opener?.isConnected && !opener.matches('input, textarea, select')) opener.focus({ preventScroll: true })
    }
  }, [])

  const setY = (dy: number) => {
    if (panel.current) panel.current.style.transform = dy > 0 ? `translateY(${dy}px)` : ''
  }

  return createPortal(
    <div className="sheet" role="presentation" onClick={onClose}>
      <div
        ref={panel}
        className="sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="sheet__grip"
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, dy: 0 }
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (!drag.current) return
            drag.current.dy = Math.max(0, e.clientY - drag.current.y)
            setY(drag.current.dy)
          }}
          onPointerUp={() => {
            const dy = drag.current?.dy ?? 0
            drag.current = null
            if (dy > 90) onClose()
            else setY(0)
          }}
        >
          <span aria-hidden="true" />
        </div>
        <div className="sheet__head">
          <h2>{title}</h2>
          <button type="button" className="sheet__close" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/** Interrupteur à bascule, façon réglages iOS. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label: ReactNode
  hint?: ReactNode
}) {
  return (
    <label className={`switch${disabled ? ' switch--off' : ''}`}>
      <span className="switch__text">
        <span className="switch__label">{label}</span>
        {hint && <span className="switch__hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" aria-hidden="true"><span className="switch__thumb" /></span>
    </label>
  )
}
