import { useRef, useState } from 'react'

const MESSAGES = [
  '📺 Chaîne secrète débloquée : Zapping.',
  '🕹️ Œuf de Pâques trouvé. Retourne binge-watcher.',
  "📼 Rembobinage... tu es resté(e) un peu trop longtemps ici.",
  "🔧 Rien à régler ici, juste un clin d'œil.",
]

/**
 * Cinq taps rapides sur le logo, comme secouer une vieille télé : un clin
 * d'œil sans rien débloquer de plus.
 */
export function useLogoEasterEgg() {
  const taps = useRef<number[]>([])
  const [message, setMessage] = useState<string | null>(null)

  function onTap() {
    const now = Date.now()
    taps.current = [...taps.current, now].filter((t) => now - t < 2000)
    if (taps.current.length >= 5) {
      taps.current = []
      setMessage(MESSAGES[Math.floor(Math.random() * MESSAGES.length)])
      setTimeout(() => setMessage(null), 1800)
    }
  }

  return { onTap, message }
}

export function EasterEggOverlay({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="easter-egg" role="status" aria-live="polite">
      <p>{message}</p>
    </div>
  )
}
