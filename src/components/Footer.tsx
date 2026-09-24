import { useMemo, useState } from 'react'
import { useApp } from '../lib/appState'
import { useBooks } from '../lib/booksState'
import { usePrefs } from '../lib/prefs'

/**
 * Un petit easter egg façon vieille télé : cliquer sur le témoin change de
 * « chaîne » avec un bref grésillement, entre une vraie statistique tirée
 * des données de l'utilisatrice, une blague, et un message de fin de
 * programme. Les mentions légales, elles, restent toujours visibles au-dessus.
 */
export function Footer({ tmdbConfigured }: { tmdbConfigured: boolean }) {
  const { tracked, movies, watched } = useApp()
  const { books } = useBooks()
  const { has } = usePrefs()
  const booksRead = books.filter((b) => b.status === 'read').length
  const [channel, setChannel] = useState(0)
  const [flicker, setFlicker] = useState(false)

  const totalEpisodes = useMemo(
    () => [...watched.values()].reduce((n, eps) => n + eps.size, 0),
    [watched],
  )

  const channels = useMemo(() => {
    const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`
    const counts = [
      has('show') && `${plural(totalEpisodes, 'épisode')} coché${totalEpisodes > 1 ? 's' : ''}, ${plural(tracked.length, 'série')} suivie${tracked.length > 1 ? 's' : ''}`,
      has('movie') && `${plural(movies.length, 'film')} vu${movies.length > 1 ? 's' : ''}`,
      has('book') && `${plural(booksRead, 'livre')} lu${booksRead > 1 ? 's' : ''}`,
    ].filter(Boolean)
    const list = [
      `📊 ${counts.join(', ')}. Zapping ne dort jamais.`,
      has('show') && "💬 « Juste un épisode » — toi, il y a trois heures.",
      has('book') && '📖 « Encore un chapitre » — toi, à deux heures du matin.',
      "📡 Signal perdu... rebranche l'antenne, ou va plutôt te coucher.",
      '💜 Fait avec beaucoup trop de café, pour ne plus jamais perdre le fil.',
    ].filter((c): c is string => !!c)
    return list
  }, [totalEpisodes, tracked.length, movies.length, booksRead, has])

  function next() {
    setFlicker(true)
    setTimeout(() => setFlicker(false), 220)
    setChannel((c) => (c + 1) % channels.length)
  }

  return (
    <footer className="footer muted">
      <p>Données séries : TVmaze.com (CC BY-SA) · Livres : Open Library et Google Books</p>
      {/* Mention exigée par les conditions d'utilisation de l'API TMDB. */}
      {tmdbConfigured && (
        <p>Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB.</p>
      )}
      <button
        type="button"
        className={`footer__tv${flicker ? ' footer__tv--flicker' : ''}`}
        onClick={next}
        aria-label="Changer de chaîne"
        title="Changer de chaîne"
      >
        📺 <span className="footer__tv-text">{channels[channel % channels.length]}</span>
      </button>
    </footer>
  )
}
