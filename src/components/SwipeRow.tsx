import { useRef, useState, type CSSProperties, type ReactNode } from 'react'

type Action = {
  label: string
  onSwipe: () => void
  /** Icône du bouton (ordinateur) ; par défaut ✓ à droite, ✕ à gauche. */
  icon?: IconName
}
type IconName = 'check' | 'remove' | 'resume'

/** Au-delà de cette part de la largeur, lâcher déclenche l'action. */
const THRESHOLD = 0.35
/** Mouvement minimal avant de décider entre glisser et faire défiler la page. */
const SLOP = 10

/**
 * Ligne de liste qui se glisse au doigt, façon Mail sur iPhone : vers la
 * droite pour `right`, vers la gauche pour `left`. Tactile seulement — à la
 * souris, les boutons de la ligne suffisent, et un glisser-déposer
 * involontaire en sélectionnant du texte serait pire qu'utile.
 *
 * Le geste ne démarre qu'une fois clairement horizontal : un défilement
 * vertical de la page ne doit jamais retirer un livre par accident.
 */
export function SwipeRow({
  className = 'row',
  left,
  right,
  children,
  rowRef,
  style,
  buttonsFor,
}: {
  className?: string
  left?: Action
  right?: Action
  children: ReactNode
  /** Pour le glisser-déposer : la ligne se mesure et suit le doigt. */
  rowRef?: (el: HTMLElement | null) => void
  style?: CSSProperties
  /**
   * Titre de la ligne, pour les lignes qui n'ont pas déjà leurs propres
   * boutons : les actions du glissé s'affichent alors aussi en boutons
   * icônes. Visibles à la souris ; au doigt, cachés à l'écran mais
   * atteignables au clavier et par les lecteurs d'écran.
   */
  buttonsFor?: string
}) {
  const [dx, setDx] = useState(0)
  const [leaving, setLeaving] = useState<'left' | 'right' | null>(null)
  const start = useRef<{ x: number; y: number; id: number } | null>(null)
  const swiping = useRef(false)
  const suppressClick = useRef(false)
  const width = useRef(1)
  // Le décalage courant, lu au lâcher : l'état React peut ne pas être encore
  // à jour quand pointerup suit de près le dernier pointermove.
  const offset = useRef(0)
  const move = (x: number) => {
    offset.current = x
    setDx(x)
  }

  function reset() {
    start.current = null
    swiping.current = false
    move(0)
  }

  return (
    <li
      ref={rowRef}
      style={style}
      className={`swipe${leaving ? ` swipe--leaving-${leaving}` : ''}`}
      onPointerDown={(e) => {
        if (e.pointerType !== 'touch' || leaving) return
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
        width.current = e.currentTarget.offsetWidth || 1
      }}
      onPointerMove={(e) => {
        const s = start.current
        if (!s || s.id !== e.pointerId) return
        const mx = e.clientX - s.x
        const my = e.clientY - s.y
        if (!swiping.current) {
          if (Math.abs(my) > SLOP && Math.abs(my) > Math.abs(mx)) {
            start.current = null // défilement vertical : on laisse faire
            return
          }
          if (Math.abs(mx) < SLOP) return
          swiping.current = true
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* pointeur déjà relâché : le geste continue sans capture */
          }
        }
        // Pas d'action de ce côté : la ligne résiste au lieu de suivre le doigt.
        const allowed = (mx > 0 && right) || (mx < 0 && left)
        move(allowed ? mx : mx / 6)
      }}
      onPointerUp={() => {
        if (!swiping.current) return reset()
        // Le clic qui suit le lâcher ne doit pas ouvrir la fiche.
        suppressClick.current = true
        setTimeout(() => (suppressClick.current = false), 350)
        const ratio = offset.current / width.current
        const action = ratio > THRESHOLD ? right : ratio < -THRESHOLD ? left : undefined
        if (!action) return reset()
        const side = ratio > 0 ? 'right' : 'left'
        setLeaving(side)
        move(side === 'right' ? width.current : -width.current)
        // Laisse la ligne finir de sortir avant de la retirer de la liste.
        setTimeout(() => {
          action.onSwipe()
          setLeaving(null)
          reset()
        }, 180)
      }}
      onPointerCancel={reset}
      // Un glissé ne doit pas finir en ouverture de la fiche.
      onClickCapture={(e) => {
        if (suppressClick.current || swiping.current) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
    >
      {right && (
        <div className="swipe__bg swipe__bg--right" style={{ opacity: dx > 0 ? 1 : 0 }} aria-hidden="true">
          {right.label}
        </div>
      )}
      {left && (
        <div className="swipe__bg swipe__bg--left" style={{ opacity: dx < 0 ? 1 : 0 }} aria-hidden="true">
          {left.label}
        </div>
      )}
      <div
        className={`swipe__content ${className}`}
        style={{
          transform: dx ? `translateX(${dx}px)` : undefined,
          transition: swiping.current && !leaving ? 'none' : undefined,
        }}
      >
        {children}
        {buttonsFor && (right || left) && (
          <div className="swipe__buttons">
            {right && <IconButton action={right} name={buttonsFor} fallback="check" />}
            {left && <IconButton action={left} name={buttonsFor} fallback="remove" />}
          </div>
        )}
      </div>
    </li>
  )
}

function IconButton({ action, name, fallback }: { action: Action; name: string; fallback: IconName }) {
  return (
    <button type="button" className="icon-btn" title={action.label} aria-label={`${action.label} : ${name}`} onClick={action.onSwipe}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICONS[action.icon ?? fallback]}
      </svg>
    </button>
  )
}

const ICONS: Record<IconName, ReactNode> = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  remove: <path d="M6 6l12 12M18 6L6 18" />,
  resume: <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" />,
}
