import { useEffect, useRef, useState } from 'react'
import { removeAvatar, uploadAvatar, type Profile } from '../lib/social'
import { useSocial } from '../lib/socialState'
import { Avatar } from './Friends'
import { Sheet } from './Sheet'

/** Côté de la zone de cadrage à l'écran, et de l'image envoyée. */
const VIEW = 260
const OUT = 320
const MAX_ZOOM = 4

/**
 * Ma pastille, avec un petit appareil photo dessus : un tap ouvre la
 * photothèque, puis le cadrage.
 */
export function MyAvatar({ profile }: { profile: Profile }) {
  const { setProfile } = useSocial()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = () => {
    setMenu(false)
    input.current?.click()
  }

  async function save(job: () => Promise<string | null>) {
    setBusy(true)
    setError(null)
    try {
      setProfile({ ...profile, avatar_url: await job() })
      setFile(null)
      setMenu(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="avatar-edit"
        onClick={() => (profile.avatar_url ? setMenu(true) : pick())}
        aria-label={profile.avatar_url ? 'Changer ma photo' : 'Ajouter une photo'}
      >
        <Avatar profile={profile} size="lg" />
        <span className="avatar-edit__cam" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) {
            setError(null)
            setFile(f)
          }
        }}
      />

      {menu && !file && (
        <Sheet title="Ma photo" onClose={() => setMenu(false)}>
          <div className="choices">
            <button className="btn btn--primary" onClick={pick}>Choisir une autre photo</button>
            <button className="btn btn--ghost" disabled={busy} onClick={() => save(async () => (await removeAvatar(), null))}>
              {busy ? 'Suppression…' : 'Retirer la photo'}
            </button>
            {error && <p className="error">{error}</p>}
          </div>
        </Sheet>
      )}

      {file && (
        <Sheet title="Cadrer la photo" onClose={() => !busy && setFile(null)}>
          <Cropper
            file={file}
            busy={busy}
            error={error}
            onCancel={() => setFile(null)}
            onDone={(blob) => save(() => uploadAvatar(blob))}
          />
        </Sheet>
      )}
    </>
  )
}

type View = { zoom: number; x: number; y: number }

/** Déplacer au doigt, zoomer en pinçant ou au curseur ; le rond montre ce qui sera gardé. */
function Cropper({
  file,
  busy,
  error,
  onCancel,
  onDone,
}: {
  file: File
  busy: boolean
  error: string | null
  onCancel: () => void
  onDone: (b: Blob) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [bmp, setBmp] = useState<ImageBitmap | null>(null)
  const [failed, setFailed] = useState(false)
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; zoom: number } | null>(null)

  useEffect(() => {
    let alive = true
    let made: ImageBitmap | null = null
    createImageBitmap(file, { imageOrientation: 'from-image' })
      .then((b) => {
        made = b
        if (alive) setBmp(b)
        else b.close()
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
      made?.close()
    }
  }, [file])

  // Échelle qui remplit tout juste le carré : zoom 1 = le petit côté de la photo.
  const base = bmp ? VIEW / Math.min(bmp.width, bmp.height) : 1

  /** Garde la photo collée aux bords du carré : jamais de vide dans le rond. */
  function clamp(v: View): View {
    if (!bmp) return v
    const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom))
    const s = base * zoom
    const w = bmp.width * s
    const h = bmp.height * s
    return { zoom, x: Math.min(0, Math.max(VIEW - w, v.x)), y: Math.min(0, Math.max(VIEW - h, v.y)) }
  }

  // Centré au départ.
  useEffect(() => {
    if (!bmp) return
    const s = VIEW / Math.min(bmp.width, bmp.height)
    setView({ zoom: 1, x: (VIEW - bmp.width * s) / 2, y: (VIEW - bmp.height * s) / 2 })
  }, [bmp])

  useEffect(() => {
    const c = canvas.current
    if (!c || !bmp) return
    const dpr = window.devicePixelRatio || 1
    c.width = c.height = VIEW * dpr
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, VIEW, VIEW)
    const s = base * view.zoom
    ctx.drawImage(bmp, view.x, view.y, bmp.width * s, bmp.height * s)
  }, [bmp, view, base])

  /** Zoome autour d'un point du carré (le centre, ou entre les deux doigts). */
  function zoomAt(next: number, cx = VIEW / 2, cy = VIEW / 2) {
    setView((v) => {
      const z = Math.min(MAX_ZOOM, Math.max(1, next))
      const k = z / v.zoom
      return clamp({ zoom: z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k })
    })
  }

  function local(e: React.PointerEvent) {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * VIEW, y: ((e.clientY - r.top) / r.height) * VIEW }
  }

  function exportBlob() {
    if (!bmp) return
    const s = base * view.zoom
    const out = document.createElement('canvas')
    out.width = out.height = OUT
    const ctx = out.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, -view.x / s, -view.y / s, VIEW / s, VIEW / s, 0, 0, OUT, OUT)
    out.toBlob((b) => b && onDone(b), 'image/jpeg', 0.85)
  }

  if (failed) {
    return (
      <div className="cropper">
        <p className="error">Impossible de lire cette image. Essaie une photo en JPEG ou PNG.</p>
        <button className="btn btn--ghost" onClick={onCancel}>Fermer</button>
      </div>
    )
  }

  return (
    <div className="cropper">
      <div
        className="cropper__frame"
        style={{ width: VIEW, height: VIEW }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pointers.current.set(e.pointerId, local(e))
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()]
            pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom }
          }
        }}
        onPointerMove={(e) => {
          const prev = pointers.current.get(e.pointerId)
          if (!prev) return
          const p = local(e)
          pointers.current.set(e.pointerId, p)
          if (pointers.current.size === 2 && pinch.current) {
            const [a, b] = [...pointers.current.values()]
            const d = Math.hypot(a.x - b.x, a.y - b.y)
            zoomAt((pinch.current.zoom * d) / pinch.current.dist, (a.x + b.x) / 2, (a.y + b.y) / 2)
          } else if (pointers.current.size === 1) {
            setView((v) => clamp({ ...v, x: v.x + p.x - prev.x, y: v.y + p.y - prev.y }))
          }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId)
          if (pointers.current.size < 2) pinch.current = null
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId)
          pinch.current = null
        }}
        onWheel={(e) => zoomAt(view.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))}
      >
        <canvas ref={canvas} style={{ width: VIEW, height: VIEW }} />
        <span className="cropper__mask" aria-hidden="true" />
      </div>

      <label className="cropper__zoom">
        <span aria-hidden="true">−</span>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={view.zoom}
          onChange={(e) => zoomAt(Number(e.target.value))}
          aria-label="Zoom"
        />
        <span aria-hidden="true">+</span>
      </label>
      <p className="muted cropper__hint">Fais glisser la photo pour la placer dans le rond, pince pour zoomer.</p>

      {error && <p className="error">{error}</p>}
      <div className="movie__actions">
        <button className="btn btn--primary" disabled={!bmp || busy} onClick={exportBlob}>
          {busy ? 'Envoi…' : 'Enregistrer'}
        </button>
        <button className="btn btn--ghost" disabled={busy} onClick={onCancel}>Annuler</button>
      </div>
    </div>
  )
}
