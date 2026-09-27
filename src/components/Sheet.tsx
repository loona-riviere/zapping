import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Feuille qui monte du bas de l'écran, façon iOS : fond assombri, poignée,
 * fermeture par le fond, par « Fermer », par Échap ou en la tirant vers le
 * bas. Le contenu défile à l'intérieur ; la page derrière ne bouge pas.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; dy: number } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])

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
