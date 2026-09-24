import { useMemo, useRef, useState } from 'react'
import { useApp } from '../lib/appState'
import { useBooks } from '../lib/booksState'
import { usePrefs } from '../lib/prefs'

const STATIC_MESSAGES = [
  '📺 Chaîne secrète débloquée : Zapping.',
  "📼 Rembobinage... tu es resté(e) un peu trop longtemps ici.",
  "🔧 Rien à régler ici, juste un clin d'œil.",
  "📡 Signal perdu... rebranche l'antenne, ou va plutôt te coucher.",
  '💜 Fait avec beaucoup trop de café, pour ne plus jamais perdre le fil.',
]

const fr = (n: number) => Math.round(n).toLocaleString('fr-FR')
const s = (n: number) => (n > 1 ? 's' : '')

/**
 * Cinq taps rapides sur le logo, comme secouer une vieille télé : un clin
 * d'œil, mêlant blagues fixes et petits faits tirés des vraies données
 * (séries, films, livres suivis), avec des comparaisons pour se rendre
 * compte — jamais deux fois exactement le même écran.
 */
export function useLogoEasterEgg() {
  const { tracked, watched, movies } = useApp()
  const { books } = useBooks()
  const { has } = usePrefs()
  const taps = useRef<number[]>([])
  const last = useRef<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const personalized = useMemo(() => {
    const msgs: string[] = []

    if (has('show')) {
      msgs.push('🕹️ Œuf de Pâques trouvé. Retourne binge-watcher.', "💬 « Juste un épisode » — toi, il y a trois heures.")
      const withCounts = tracked.map((t) => ({ name: t.name, count: watched.get(t.show_id)?.size ?? 0 }))
      const top = withCounts.reduce<{ name: string; count: number } | null>(
        (best, cur) => (cur.count > 0 && (!best || cur.count > best.count) ? cur : best),
        null,
      )
      if (top) msgs.push(`🏆 Ta série la plus regardée : ${top.name}, ${fr(top.count)} épisode${s(top.count)}.`)
      const episodes = withCounts.reduce((n, c) => n + c.count, 0)
      // ~40 min l'épisode en moyenne : assez juste pour une comparaison, pas pour les stats.
      if (episodes >= 20) {
        const hours = (episodes * 40) / 60
        msgs.push(`✈️ ${fr(episodes)} épisodes, c'est à peu près ${fr(hours / 14)} allers simples Paris–Tokyo passés devant l'écran.`)
      }
      const rewatches = tracked.reduce((sum, t) => sum + t.rewatches, 0)
      if (rewatches > 0) msgs.push(`🔁 ${rewatches} revisionnage${s(rewatches)} complet${s(rewatches)}. Une vraie fidèle.`)
      const dropped = tracked.filter((t) => t.status === 'dropped').length
      if (dropped >= 3) msgs.push(`🚪 ${dropped} séries abandonnées en route. Ça arrive aux meilleur(e)s.`)
    }

    if (has('movie')) {
      const seen = movies.filter((m) => m.status === 'watched')
      const minutes = seen.reduce((n, m) => n + (m.runtime ?? 0), 0)
      if (minutes >= 600) {
        msgs.push(`🍿 Tes ${fr(seen.length)} films mis bout à bout : ${fr(minutes / 60)} h, soit ${fr(minutes / 60 / 24)} jour${s(minutes / 60 / 24)} sans dormir.`)
      }
      const longest = seen.reduce<(typeof seen)[number] | null>((b, m) => ((m.runtime ?? 0) > (b?.runtime ?? 0) ? m : b), null)
      if (longest?.runtime && longest.runtime >= 150) msgs.push(`⏳ Ton film le plus long : ${longest.title}, ${fr(longest.runtime)} minutes. Courage.`)
    }

    if (has('book')) {
      const read = books.filter((b) => b.status === 'read')
      const pages = read.reduce((n, b) => n + (b.page_count ?? 0), 0)
      if (pages >= 300) {
        // Une page de poche fait environ 18 cm de haut.
        msgs.push(`📏 Tes ${fr(pages)} pages lues, posées bout à bout : ${(pages * 0.18 / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km de lecture.`)
        msgs.push(`🌹 ${fr(pages)} pages, c'est ${fr(pages / 96)} fois Le Petit Prince.`)
      }
      const byAuthor = new Map<string, number>()
      read.forEach((b) => b.authors && byAuthor.set(b.authors, (byAuthor.get(b.authors) ?? 0) + 1))
      const [author, count] = [...byAuthor.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
      if (author && count && count >= 2) msgs.push(`✍️ Ton auteur le plus lu : ${author}, ${count} livres.`)
      const longestBook = read.reduce<(typeof read)[number] | null>((b, x) => ((x.page_count ?? 0) > (b?.page_count ?? 0) ? x : b), null)
      if (longestBook?.page_count && longestBook.page_count >= 400) msgs.push(`🧱 Ton plus gros pavé : ${longestBook.title}, ${fr(longestBook.page_count)} pages.`)
      msgs.push('📖 « Encore un chapitre » — toi, à deux heures du matin.')
    }

    const loved =
      (has('show') ? tracked.filter((t) => t.rating === 'love').length : 0) +
      (has('movie') ? movies.filter((m) => m.rating === 'love').length : 0) +
      (has('book') ? books.filter((b) => b.rating === 'love').length : 0)
    if (loved > 0) msgs.push(`❤️ ${loved} coup${s(loved)} de cœur au compteur. Difficile de choisir, hein ?`)

    return msgs
  }, [tracked, watched, movies, books, has])

  function onTap() {
    const now = Date.now()
    taps.current = [...taps.current, now].filter((t) => now - t < 2000)
    if (taps.current.length >= 5) {
      taps.current = []
      // Jamais deux fois de suite le même.
      const pool = [...STATIC_MESSAGES, ...personalized].filter((m) => m !== last.current)
      const pick = pool[Math.floor(Math.random() * pool.length)]
      last.current = pick
      setMessage(pick)
      setTimeout(() => setMessage(null), 3500)
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
