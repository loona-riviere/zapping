import { useEffect, useState } from 'react'
import { isStandalone } from '../lib/push'
import { trendingPosters } from '../lib/tmdb'

const ROWS = 4
const PER_ROW = 10

/** La bande de couleurs d'une mire TV, rappel de la palette de l'app. */
export function Mire({ animated = false }: { animated?: boolean }) {
  return (
    <div className={`mire${animated ? ' mire--animated' : ''}`} aria-hidden="true">
      {['#e8e8e8', '#f2d600', '#00c3d9', '#1fcf5a', '#d63fc8', '#e8313a', '#2b45f5'].map((c) => (
        <span key={c} style={{ background: c }} />
      ))}
    </div>
  )
}

/**
 * Mur d'affiches tendance qui défile lentement derrière l'écran de connexion,
 * voilé pour que le formulaire reste lisible. Chaque rangée est dupliquée
 * pour boucler sans à-coup. Purement décoratif.
 */
export function PosterWall() {
  const [posters, setPosters] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    trendingPosters().then((p) => alive && setPosters(p))
    return () => {
      alive = false
    }
  }, [])

  if (posters.length < 8) return null
  const rows = Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: PER_ROW }, (_, i) => posters[(r * PER_ROW + i * 3 + r) % posters.length]),
  )

  return (
    <div className="poster-wall" aria-hidden="true">
      {rows.map((row, r) => (
        <div key={r} className="poster-wall__row">
          {[...row, ...row].map((src, i) => (
            <img key={i} src={src} alt="" loading="eager" decoding="async" />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Écran de lancement, le temps de retrouver la session (quelques dixièmes de seconde). */
export function Splash() {
  return (
    <main className="splash" aria-label="Chargement de Zapping">
      <h1 className="wordmark wordmark--big">Zapping</h1>
      <Mire animated />
    </main>
  )
}

const LAUNCH_MS = 1500
const FADE_MS = 400

/**
 * Écran d'ouverture quand l'app est lancée depuis son icône d'écran
 * d'accueil : logo et mire devant le mur d'affiches, ~1,5 s, puis fondu vers
 * l'app, qui charge derrière pendant ce temps. Un toucher le passe. Pas dans
 * un onglet de navigateur, où ce serait juste une attente de plus.
 */
export function LaunchScreen() {
  const [stage, setStage] = useState<'on' | 'leaving' | 'off'>(() => (isStandalone() ? 'on' : 'off'))

  useEffect(() => {
    if (stage !== 'on') return
    const t = setTimeout(() => setStage('leaving'), LAUNCH_MS)
    return () => clearTimeout(t)
  }, [stage])

  useEffect(() => {
    if (stage !== 'leaving') return
    const t = setTimeout(() => setStage('off'), FADE_MS)
    return () => clearTimeout(t)
  }, [stage])

  if (stage === 'off') return null
  return (
    <div
      className={`launch${stage === 'leaving' ? ' launch--leaving' : ''}`}
      onClick={() => setStage('leaving')}
      aria-hidden="true"
    >
      <PosterWall />
      <div className="auth-screen__veil" />
      <div className="launch__brand">
        <p className="wordmark wordmark--big">Zapping</p>
        <Mire animated />
      </div>
    </div>
  )
}
