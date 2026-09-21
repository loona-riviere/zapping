import { useEffect, useState } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'search'; q?: string; kind?: 'show' | 'movie' }
  | { name: 'import' }
  | { name: 'movies' }
  | { name: 'stats' }
  | { name: 'show'; id: number }

function parse(hash: string): Route {
  if (hash.startsWith('#/search')) {
    const params = new URLSearchParams(hash.split('?')[1] ?? '')
    const q = params.get('q')
    const kind = params.get('kind')
    return { name: 'search', q: q ?? undefined, kind: kind === 'movie' ? 'movie' : kind === 'show' ? 'show' : undefined }
  }
  if (hash.startsWith('#/import')) return { name: 'import' }
  if (hash.startsWith('#/films')) return { name: 'movies' }
  if (hash.startsWith('#/stats')) return { name: 'stats' }
  const m = hash.match(/^#\/show\/(\d+)/)
  if (m) return { name: 'show', id: Number(m[1]) }
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
  searchFor: (q: string, kind?: 'show' | 'movie') =>
    `#/search?q=${encodeURIComponent(q)}${kind ? `&kind=${kind}` : ''}`,
  import: '#/import',
  movies: '#/films',
  stats: '#/stats',
  show: (id: number) => `#/show/${id}`,
}
