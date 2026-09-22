import { useMemo, useRef, useState } from 'react'
import { useApp } from '../lib/appState'

const STATIC_MESSAGES = [
  '📺 Chaîne secrète débloquée : Zapping.',
  '🕹️ Œuf de Pâques trouvé. Retourne binge-watcher.',
  "📼 Rembobinage... tu es resté(e) un peu trop longtemps ici.",
  "🔧 Rien à régler ici, juste un clin d'œil.",
]

/**
 * Cinq taps rapides sur le logo, comme secouer une vieille télé : un clin
 * d'œil, mêlant blagues fixes et petits faits tirés des vraies données —
 * jamais deux fois exactement le même écran.
 */
export function useLogoEasterEgg() {
  const { tracked, watched, movies } = useApp()
  const taps = useRef<number[]>([])
  const [message, setMessage] = useState<string | null>(null)

  const personalized = useMemo(() => {
    const msgs: string[] = []

    const withCounts = tracked.map((t) => ({ name: t.name, count: watched.get(t.show_id)?.size ?? 0 }))
    const top = withCounts.reduce<{ name: string; count: number } | null>(
      (best, cur) => (cur.count > 0 && (!best || cur.count > best.count) ? cur : best),
      null,
    )
    if (top) {
      msgs.push(`🏆 Ta série la plus regardée : ${top.name}, ${top.count} épisode${top.count > 1 ? 's' : ''}.`)
    }

    const loved = tracked.filter((t) => t.rating === 'love').length + movies.filter((m) => m.rating === 'love').length
    if (loved > 0) {
      msgs.push(`❤️ ${loved} coup${loved > 1 ? 's' : ''} de cœur au compteur. Difficile de choisir, hein ?`)
    }

    const rewatches = tracked.reduce((sum, t) => sum + t.rewatches, 0)
    if (rewatches > 0) {
      msgs.push(`🔁 ${rewatches} revisionnage${rewatches > 1 ? 's' : ''} complet${rewatches > 1 ? 's' : ''}. Une vraie fidèle.`)
    }

    const dropped = tracked.filter((t) => t.status === 'dropped').length
    if (dropped >= 3) {
      msgs.push(`🚪 ${dropped} séries abandonnées en route. Ça arrive aux meilleur(e)s.`)
    }

    return msgs
  }, [tracked, watched, movies])

  function onTap() {
    const now = Date.now()
    taps.current = [...taps.current, now].filter((t) => now - t < 2000)
    if (taps.current.length >= 5) {
      taps.current = []
      const pool = [...STATIC_MESSAGES, ...personalized]
      setMessage(pool[Math.floor(Math.random() * pool.length)])
      setTimeout(() => setMessage(null), 2200)
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
