import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../lib/appState'
import { href } from '../lib/route'
import {
  movieRecommendations, tmdbConfigured, tvRecommendationsByImdb,
  type Movie, type TvRecommendation,
} from '../lib/tmdb'
import { useShowEpisodes } from '../lib/useShows'
import { Poster } from './Poster'

/**
 * Suggestions de films à partir des derniers vus, via les recommandations
 * TMDB. Cliquer ajoute directement le film à la liste « à voir ».
 */
export function MovieRecommendations() {
  const { movies, addToWatchlist } = useApp()
  const [recs, setRecs] = useState<Movie[]>([])

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
      return
    }
    let alive = true
    Promise.all(seeds.map((s) => movieRecommendations(s.movie_id))).then((lists) => {
      if (!alive) return
      const known = new Set(movies.map((m) => m.movie_id))
      const byId = new Map<number, Movie>()
      for (const list of lists) {
        for (const m of list) {
          if (!known.has(m.id) && !byId.has(m.id)) byId.set(m.id, m)
        }
      }
      setRecs([...byId.values()].slice(0, 10))
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeds])

  if (!recs.length) return null

  return (
    <section>
      <h2 className="section-title">Recommandé pour toi</h2>
      <ul className="shelf">
        {recs.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              className="shelf__pick"
              onClick={() => addToWatchlist(m)}
              title={`Ajouter ${m.title} à voir`}
            >
              <Poster src={m.poster_url} alt={m.title} />
              <span className="shelf__label">{m.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Suggestions de séries à partir des séries suivies les plus actives. TMDB
 * ne connaît pas les identifiants TVmaze : cliquer envoie chercher le titre
 * sur l'onglet Chercher plutôt que vers une fiche qu'on ne peut pas déduire.
 */
export function ShowRecommendations({ showIds }: { showIds: number[] }) {
  const { data } = useShowEpisodes(showIds)
  const [recs, setRecs] = useState<TvRecommendation[]>([])
  const trackedNames = useMemo(
    () => new Set(Object.values(data).map((d) => d.show.name.toLowerCase())),
    [data],
  )

  const imdbIds = useMemo(
    () => showIds.map((id) => data[id]?.show.externals?.imdb).filter((v): v is string => !!v).slice(0, 3),
    [showIds, data],
  )

  useEffect(() => {
    if (!tmdbConfigured || !imdbIds.length) {
      setRecs([])
      return
    }
    let alive = true
    Promise.all(imdbIds.map((id) => tvRecommendationsByImdb(id))).then((lists) => {
      if (!alive) return
      const byId = new Map<number, TvRecommendation>()
      for (const list of lists) {
        for (const r of list) {
          if (!trackedNames.has(r.name.toLowerCase()) && !byId.has(r.id)) byId.set(r.id, r)
        }
      }
      setRecs([...byId.values()].slice(0, 10))
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imdbIds])

  if (!recs.length) return null

  return (
    <section>
      <h2 className="section-title">Recommandé pour toi</h2>
      <ul className="shelf">
        {recs.map((r) => (
          <li key={r.id}>
            <a href={href.searchFor(r.name)} title={`Chercher ${r.name}`}>
              <Poster src={r.poster_url} alt={r.name} />
              <span className="shelf__label">{r.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
