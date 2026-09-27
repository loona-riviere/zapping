import { useEffect, useState } from 'react'

export type SearchKind = 'show' | 'movie' | 'book'

export type Route =
  | { name: 'home' }
  | { name: 'search'; q?: string; kind?: SearchKind }
  | { name: 'import' }
  | { name: 'movies' }
  | { name: 'stats' }
  | { name: 'settings' }
  | { name: 'show'; id: number }
  | { name: 'episode'; showId: number; episodeId: number }
  | { name: 'movie'; id: number }
  | { name: 'books' }
  | { name: 'book'; id: string }
  | { name: 'friends' }
  | { name: 'friend'; username: string }

function parse(hash: string): Route {
  if (hash.startsWith('#/search')) {
    const params = new URLSearchParams(hash.split('?')[1] ?? '')
    const q = params.get('q')
    const kind = params.get('kind')
    return {
      name: 'search',
      q: q ?? undefined,
      kind: kind === 'movie' || kind === 'show' || kind === 'book' ? kind : undefined,
    }
  }
  if (hash.startsWith('#/import')) return { name: 'import' }
  if (hash.startsWith('#/films')) return { name: 'movies' }
  if (/^#\/livres(?:[/?]|$)/.test(hash)) return { name: 'books' }
  if (/^#\/amis(?:[/?]|$)/.test(hash)) return { name: 'friends' }
  const friend = hash.match(/^#\/ami\/([^?/]+)/)
  if (friend) return { name: 'friend', username: decodeURIComponent(friend[1]) }
  if (hash.startsWith('#/stats')) return { name: 'stats' }
  if (hash.startsWith('#/parametres')) return { name: 'settings' }
  const ep = hash.match(/^#\/show\/(\d+)\/ep\/(\d+)/)
  if (ep) return { name: 'episode', showId: Number(ep[1]), episodeId: Number(ep[2]) }
  const show = hash.match(/^#\/show\/(\d+)/)
  if (show) return { name: 'show', id: Number(show[1]) }
  const movie = hash.match(/^#\/movie\/(\d+)/)
  if (movie) return { name: 'movie', id: Number(movie[1]) }
  // Identifiant texte (« gb:… », « ol:… ») : encodé dans l'URL.
  const book = hash.match(/^#\/livre\/([^?]+)/)
  if (book) return { name: 'book', id: decodeURIComponent(book[1]) }
  return { name: 'home' }
}

const positions = new Map<string, number>()

/** Défile jusqu'à `y`, en réessayant le temps que l'écran se remplisse. */
function restoreScroll(y: number) {
  window.scrollTo(0, y)
  if (!y) return
  let tries = 0
  const again = () => {
    if (Math.abs(window.scrollY - y) < 2 || tries++ > 20) return
    window.scrollTo(0, y)
    setTimeout(again, 50)
  }
  setTimeout(again, 30)
}

export function useRoute(): Route {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    // Position de défilement de chaque écran visité : « retour » y ramène,
    // un nouvel écran s'ouvre en haut.
    let back = false
    let current = window.location.hash
    const onPop = () => (back = true)
    const onChange = () => {
      positions.set(current, window.scrollY)
      current = window.location.hash
      setHash(current)
      const y = back ? positions.get(current) ?? 0 : 0
      back = false
      restoreScroll(y)
    }
    const remember = () => positions.set(current, window.scrollY)
    window.addEventListener('popstate', onPop)
    window.addEventListener('hashchange', onChange)
    window.addEventListener('scroll', remember, { passive: true })
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('hashchange', onChange)
      window.removeEventListener('scroll', remember)
    }
  }, [])
  return parse(hash)
}

export const href = {
  home: '#/',
  search: '#/search',
  searchFor: (q: string, kind?: SearchKind) =>
    `#/search?q=${encodeURIComponent(q)}${kind ? `&kind=${kind}` : ''}`,
  import: '#/import',
  movies: '#/films',
  stats: '#/stats',
  settings: '#/parametres',
  show: (id: number) => `#/show/${id}`,
  episode: (showId: number, episodeId: number) => `#/show/${showId}/ep/${episodeId}`,
  movie: (id: number) => `#/movie/${id}`,
  books: '#/livres',
  book: (id: string) => `#/livre/${encodeURIComponent(id)}`,
  friends: '#/amis',
  friend: (username: string) => `#/ami/${encodeURIComponent(username)}`,
}
