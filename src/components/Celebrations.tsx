import { useEffect, useState } from 'react'
import { onCheer, type Cheer } from '../lib/fun'

const COLORS = ['#ff5a5f', '#ff8a4c', '#f2a900', '#1fcf5a', '#00c3d9', '#2b45f5', '#d63fc8']
const DURATION = 3200

type Piece = { left: number; delay: number; color: string; rotate: number; drift: number }

/**
 * Affiche les petits moments de fête signalés par lib/fun : un message en
 * haut de l'écran (le bas est pris par les barres « Annuler »), et une pluie
 * de confettis pour les vraies fins — sauf si l'appareil demande moins
 * d'animations.
 */
export function Celebrations() {
  const [cheer, setCheer] = useState<(Cheer & { id: number; pieces: Piece[] }) | null>(null)

  useEffect(
    () =>
      onCheer((c) => {
        const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        const pieces: Piece[] =
          c.confetti && !calm
            ? Array.from({ length: 36 }, () => ({
                left: Math.random() * 100,
                delay: Math.random() * 0.6,
                color: COLORS[Math.floor(Math.random() * COLORS.length)],
                rotate: Math.random() * 360,
                drift: (Math.random() - 0.5) * 120,
              }))
            : []
        setCheer({ ...c, id: Date.now(), pieces })
      }),
    [],
  )

  useEffect(() => {
    if (!cheer) return
    const t = setTimeout(() => setCheer(null), DURATION)
    return () => clearTimeout(t)
  }, [cheer])

  if (!cheer) return null
  return (
    <div className="cheer" key={cheer.id} onClick={() => setCheer(null)}>
      {cheer.pieces.map((p, i) => (
        <span
          key={i}
          className="cheer__confetti"
          aria-hidden="true"
          style={{
            left: `${p.left}%`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            ['--rot' as string]: `${p.rotate}deg`,
            ['--drift' as string]: `${p.drift}px`,
          }}
        />
      ))}
      <p className="cheer__text" role="status" aria-live="polite">{cheer.text}</p>
    </div>
  )
}
