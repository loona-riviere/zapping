import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../lib/appState'
import { dismiss, isDismissed } from '../lib/dismissed'
import { href } from '../lib/route'
import {
  movieRecommendations, tmdbConfigured, tvRecommendationsByImdb,
  type Movie, type TvRecommendation,
} from '../lib/tmdb'
import { searchShows } from '../lib/tvmaze'
import { useShowEpisodes } from '../lib/useShows'
import { Poster } from './Poster'

type Status = 'idle' | 'loading' | 'empty' | 'ready'

/**
 * Suggestions de films à partir des derniers vus, via les recommandations
 * TMDB. Chaque suggestion ouvre sa fiche (comme un résultat de recherche) :
 * vu, à voir ou rien — tout se décide là-bas plutôt que dans une modale à
 * choix limité. La croix écarte la suggestion pour de bon, sans y entrer.
 */
export function MovieRecommendations() {
  const { movies } = useApp()
  const [recs, setRecs] = useState<Movie[]>([])
  const [status, setStatus] = useState<Status>('idle')

  const seeds = useMemo(
    () =>
      movies
        .filter((m) => m.status === 'watched')
        .sort((a, b) => (b.watched_at ?? '').localeCompare(a.watched_at ?? ''))
        .slice(0, 3),
    [movies],
  )

  useEffect(() => {
    if (!tmdbConfigured || !seeds.length) {
      setRecs([])
      setStatus('idle')
      return
    }
    let alive = true
    setStatus('loading')
    Promise.all(seeds.map((s) => movieRecommendations(s.movie_id))).then((lists) => {
      if (!alive) return
      const known = new Set(movies.map((m) => m.movie_id))
      const byId = new Map<number, Movie>()
      for (const list of lists) {
        for (const m of list) {
          if (!known.has(m.id) && !isDismissed('movie', m.id) && !byId.has(m.id)) byId.set(m.id, m)
        }
      }
      const found = [...byId.values()].slice(0, 10)
      setRecs(found)
      setStatus(found.length ? 'ready' : 'empty')
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeds])

  function skip(m: Movie) {
    dismiss('movie', m.id)
    setRecs((prev) => prev.filter((x) => x.id !== m.id))
  }

  if (status === 'idle') return null

  return (
    <section>
      <h2 className="section-title">Recommandé pour toi</h2>
      {status === 'loading' && <p className="muted">Recherche de suggestions…</p>}
      {status === 'empty' && (
        <p className="muted">TMDB n'a rien à te proposer pour l'instant à partir de tes derniers films vus.</p>
      )}
      {status === 'ready' && (
        <ul className="shelf">
          {recs.map((m) => (
            <li key={m.id} className="shelf__item">
              <a href={href.movie(m.id)} title={m.title}>
                <Poster src={m.poster_url} alt={m.title} />
                <span className="shelf__label">{m.title}</span>
              </a>
              <button
                type="button"
                className="shelf__dismiss"
                onClick={() => skip(m)}
                aria-label={`Ne plus recommander ${m.title}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Suggestions de séries à partir des séries suivies les plus actives. TMDB
 * ne connaît pas les identifiants TVmaze : au clic, on cherche le titre chez
 * TVmaze (le meilleur résultat, ou celui dont l'année colle) et on ouvre sa
 * fiche directement — sans résultat, on le dit plutôt que de deviner.
 */
export function ShowRecommendations({ showIds }: { showIds: number[] }) {
  const { tracked } = useApp()
  const { data } = useShowEpisodes(showIds)
  const [recs, setRecs] = useState<TvRecommendation[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [opening, setOpening] = useState<number | null>(null)
  const [notFound, setNotFound] = useState<number | null>(null)
  // Toutes les séries jamais suivies, pas seulement les 3 servant de base aux
  // suggestions : une série vue puis retirée du suivi ne doit pas revenir.
  const trackedNames = useMemo(
    () => new Set(tracked.map((t) => t.name.toLowerCase())),
    [tracked],
  )

  const imdbIds = useMemo(
    () => showIds.map((id) => data[id]?.show.externals?.imdb).filter((v): v is string => !!v).slice(0, 3),
    [showIds, data],
  )

  // Tant que les fiches des séries suivies n'ont pas toutes répondu, on ne
  // sait pas encore si un IMDb ID viendra ou non.
  const stillResolving = showIds.length > 0 && showIds.some((id) => !data[id])

  useEffect(() => {
    if (!tmdbConfigured || stillResolving) return
    if (!imdbIds.length) {
      setRecs([])
      setStatus('idle')
      return
    }
    let alive = true
    setStatus('loading')
    Promise.all(imdbIds.map((id) => tvRecommendationsByImdb(id))).then((lists) => {
      if (!alive) return
      const byId = new Map<number, TvRecommendation>()
      for (const list of lists) {
        for (const r of list) {
          const alreadyTracked =
            trackedNames.has(r.name.toLowerCase()) || trackedNames.has(r.originalName.toLowerCase())
          if (!alreadyTracked && !isDismissed('show', r.id) && !byId.has(r.id)) {
            byId.set(r.id, r)
          }
        }
      }
      // TMDB propose souvent un cluster de vieilles séries américaines très
      // similaires (sitcoms 90s-2000s) : on privilégie les plus récentes.
      const minYear = new Date().getFullYear() - 12
      const found = [...byId.values()]
        .filter((r) => r.year === null || r.year >= minYear)
        .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
        .slice(0, 10)
      setRecs(found)
      setStatus(found.length ? 'ready' : 'empty')
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imdbIds, stillResolving])

  async function open(r: TvRecommendation) {
    setNotFound(null)
    setOpening(r.id)
    try {
      const results = await searchShows(r.name)
      const match =
        results.find((s) => r.year && s.premiered && Number(s.premiered.slice(0, 4)) === r.year) ??
        results[0]
      if (!match) {
        setNotFound(r.id)
        return
      }
      window.location.hash = href.show(match.id)
    } finally {
      setOpening(null)
    }
  }

  function skip(r: TvRecommendation) {
    dismiss('show', r.id)
    setRecs((prev) => prev.filter((x) => x.id !== r.id))
  }

  if (status === 'idle') return null

  return (
    <section>
      <h2 className="section-title">Recommandé pour toi</h2>
      {status === 'loading' && <p className="muted">Recherche de suggestions…</p>}
      {status === 'empty' && (
        <p className="muted">TMDB n'a rien à te proposer pour l'instant à partir de tes séries les plus actives.</p>
      )}
      {status === 'ready' && (
        <ul className="shelf">
          {recs.map((r) => (
            <li key={r.id} className="shelf__item">
              <button
                type="button"
                className="shelf__pick"
                onClick={() => open(r)}
                disabled={opening === r.id}
                title={r.name}
              >
                <Poster src={r.poster_url} alt={r.name} />
                <span className="shelf__label">{opening === r.id ? 'Ouverture…' : r.name}</span>
                {notFound === r.id && (
                  <span className="error shelf__label">Introuvable chez TVmaze</span>
                )}
              </button>
              <button
                type="button"
                className="shelf__dismiss"
                onClick={() => skip(r)}
                aria-label={`Ne plus recommander ${r.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
