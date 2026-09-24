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
  | { name: 'movie'; id: number }
  | { name: 'books' }
  | { name: 'book'; id: string }

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
  if (hash.startsWith('#/stats')) return { name: 'stats' }
  if (hash.startsWith('#/parametres')) return { name: 'settings' }
  const show = hash.match(/^#\/show\/(\d+)/)
  if (show) return { name: 'show', id: Number(show[1]) }
  const movie = hash.match(/^#\/movie\/(\d+)/)
  if (movie) return { name: 'movie', id: Number(movie[1]) }
  // Identifiant texte (« gb:… », « ol:… ») : encodé dans l'URL.
  const book = hash.match(/^#\/livre\/([^?]+)/)
  if (book) return { name: 'book', id: decodeURIComponent(book[1]) }
  return { name: 'home' }
}

export function useRoute(): Route {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash)
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
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
  movie: (id: number) => `#/movie/${id}`,
  books: '#/livres',
  book: (id: string) => `#/livre/${encodeURIComponent(id)}`,
}
