import { useEffect, useState } from 'react'
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
