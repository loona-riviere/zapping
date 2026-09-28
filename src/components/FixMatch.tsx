import { useState } from 'react'
import { searchShowsWide } from '../lib/lookup'
import { searchMovies, type Movie } from '../lib/tmdb'
import { getShowWithEpisodes, type ShowWithEpisodes, type TvShow } from '../lib/tvmaze'
import { Poster } from './Poster'

export type FixPick = { kind: 'show'; data: ShowWithEpisodes } | { kind: 'movie'; movie: Movie }

/**
 * Recherche manuelle pour une ligne d'import restée sans correspondance.
 * Une ligne « Introuvable » était jusque-là une impasse dans l'app même :
 * il fallait chercher ailleurs, puis recoller la liste corrigée. Ici on tape
 * le bon titre et on choisit dans les résultats, sans quitter l'écran.
 */
export function FixMatch({
  kind, initialQuery, onPick, onCancel,
}: {
  kind: 'show' | 'movie'
  initialQuery: string
  onPick: (pick: FixPick) => void
  onCancel: () => void
}) {
  const [query, setQuery] = useState(initialQuery)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [shows, setShows] = useState<TvShow[]>([])
  const [movies, setMovies] = useState<Movie[]>([])
  const [searched, setSearched] = useState(false)
  const [fetchingId, setFetchingId] = useState<number | null>(null)

  async function search() {
    const q = query.trim()
    if (q.length < 2) return
    setStatus('loading')
    try {
      if (kind === 'show') setShows((await searchShowsWide(q)).results)
      else setMovies(await searchMovies(q))
      setSearched(true)
      setStatus('idle')
    } catch {
      setStatus('error')
    }
  }

  async function pickShow(s: TvShow) {
    setFetchingId(s.id)
    try {
      onPick({ kind: 'show', data: await getShowWithEpisodes(s.id) })
    } catch {
      setStatus('error')
    } finally {
      setFetchingId(null)
    }
  }

  const results = kind === 'show' ? shows : movies

  return (
    <div className="fixmatch">
      <div className="fixmatch__row">
        <input
          className="fixmatch__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder={kind === 'movie' ? 'Titre du film' : 'Titre de la série'}
          autoFocus
        />
        <button className="btn btn--ghost" onClick={search} disabled={query.trim().length < 2}>
          Chercher
        </button>
        <button className="link-btn" onClick={onCancel}>Annuler</button>
      </div>

      {status === 'loading' && <p className="muted fixmatch__note">Recherche…</p>}
      {status === 'error' && <p className="error fixmatch__note">La recherche a échoué.</p>}
      {status === 'idle' && searched && !results.length && (
        <p className="muted fixmatch__note">Aucun résultat pour « {query.trim()} ».</p>
      )}

      {results.length > 0 && (
        <ul className="fixmatch__results">
          {kind === 'show'
            ? shows.map((s) => (
                <li key={s.id}>
                  <button className="fixmatch__pick" onClick={() => pickShow(s)} disabled={fetchingId === s.id}>
                    <Poster src={s.image?.medium} alt={s.name} />
                    <span>
                      {s.name} {s.premiered ? `(${s.premiered.slice(0, 4)})` : ''}
                      {fetchingId === s.id && ' — chargement…'}
                    </span>
                  </button>
                </li>
              ))
            : movies.map((m) => (
                <li key={m.id}>
                  <button className="fixmatch__pick" onClick={() => onPick({ kind: 'movie', movie: m })}>
                    <Poster src={m.poster_url} alt={m.title} />
                    <span>{m.title} {m.year ? `(${m.year})` : ''}</span>
                  </button>
                </li>
              ))}
        </ul>
      )}
    </div>
  )
}
