import { useEffect, useState } from 'react'

export type Route = { name: 'home' } | { name: 'search' } | { name: 'show'; id: number }

function parse(hash: string): Route {
  if (hash.startsWith('#/search')) return { name: 'search' }
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
  show: (id: number) => `#/show/${id}`,
}
