import { useEffect, useRef, useState } from 'react'
import { useApp } from '../lib/appState'
import { searchShowsWide } from '../lib/lookup'
import { href } from '../lib/route'
import { tmdbConfigured } from '../lib/tmdb'
import type { TvShow } from '../lib/tvmaze'
import { Poster } from './Poster'

export function Search() {
  const { isTracked, track } = useApp()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TvShow[]>([])
  // Titre original ayant permis de trouver, quand le titre français a échoué.
  const [via, setVia] = useState<string | null>(null)
  const [tried, setTried] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setVia(null)
      setTried([])
      setStatus('idle')
      return
    }
    setStatus('loading')
    let alive = true
    const t = setTimeout(() => {
      searchShowsWide(q)
        .then((r) => {
          if (!alive) return
          setResults(r.results)
          setVia(r.via ?? null)
          setTried(r.tried)
          setStatus('idle')
        })
        .catch(() => alive && setStatus('error'))
    }, 350)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query])

  return (
    <div className="search">
      <label htmlFor="q" className="visually-hidden">Nom de la série</label>
      <input
        id="q"
        ref={input}
        type="search"
        className="search__input"
        placeholder="Nom de la série"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />
      {status === 'error' && <p className="error">La recherche TVmaze a échoué. Vérifie ta connexion et réessaie.</p>}
      {status === 'idle' && query.trim().length >= 2 && !results.length && (
        <p className="muted">
          Aucune série trouvée pour « {query.trim()} ».{' '}
          {tried.length
            ? `TMDB propose ${tried.slice(0, 3).map((t) => `« ${t} »`).join(', ')}, que TVmaze ne connaît pas non plus.`
            : tmdbConfigured
              ? "TMDB ne connaît aucune série sous ce titre non plus : vérifie l'orthographe, ou cherche l'œuvre sur themoviedb.org pour relever son titre d'origine."
              : 'Essaie le titre original.'}
        </p>
      )}
      {via && (
        <p className="muted">Rien sous « {query.trim()} » — voici les résultats pour « {via} ».</p>
      )}
      <ul className="rows">
        {results.map((s) => {
          const year = s.premiered?.slice(0, 4)
          const channel = s.network?.name ?? s.webChannel?.name
          const followed = isTracked(s.id)
          return (
            <li key={s.id} className="row">
              <a href={href.show(s.id)} className="row__link">
                <Poster src={s.image?.medium} alt={s.name} />
                <div className="row__body">
                  <h3>{s.name}</h3>
                  <p className="muted">{[year, channel].filter(Boolean).join(', ')}</p>
                </div>
              </a>
              <button
                className={`btn ${followed ? 'btn--ghost' : 'btn--primary'}`}
                disabled={followed}
                onClick={() => track(s)}
              >
                {followed ? 'Suivie' : 'Suivre'}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
