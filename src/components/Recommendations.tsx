import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../lib/appState'
import { href } from '../lib/route'
import { ratingRank } from '../lib/store'
import {
  movieRecommendations, netflixTopMovies, netflixTopShows, tmdbConfigured, tvRecommendationsByImdb,
  type Movie, type TvRecommendation,
} from '../lib/tmdb'
import { searchShows } from '../lib/tvmaze'
import { useShowEpisodes } from '../lib/useShows'
import { Poster } from './Poster'

type Status = 'idle' | 'loading' | 'empty' | 'ready'

// « The Mentalist » (titre original TMDB) vs « Mentalist » (titre suivi,
// souvent sans article) : sans ça, une série déjà suivie repasse en
// recommandation simplement parce que l'article de tête diffère.
const stripArticle = (s: string) => s.replace(/^(the|a|an|le|la|les)\s+/i, '').replace(/^l['’]/i, '')
const normalizeTitle = (s: string) => stripArticle(s.toLowerCase().trim())

/**
 * Suggestions de films à partir des derniers vus, via les recommandations
 * TMDB. Chaque suggestion ouvre sa fiche (comme un résultat de recherche) :
 * vu, à voir ou rien — tout se décide là-bas plutôt que dans une modale à
 * choix limité. La croix écarte la suggestion pour de bon, sans y entrer.
 */
export function MovieRecommendations() {
  const { movies, isDismissed, dismissRec } = useApp()
  const [recs, setRecs] = useState<Movie[]>([])
  const [status, setStatus] = useState<Status>('idle')

  // Les adorés/aimés passent devant, à date égale ; un film pas aimé ne sert
  // jamais de base à une suggestion.
  const seeds = useMemo(
    () =>
      movies
        .filter((m) => m.status === 'watched' && m.rating !== 'dislike')
        .sort((a, b) => ratingRank(b.rating) - ratingRank(a.rating) || (b.watched_at ?? '').localeCompare(a.watched_at ?? ''))
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
          if (!known.has(m.id) && !byId.has(m.id)) byId.set(m.id, m)
        }
      }
      const found = [...byId.values()].slice(0, 20)
      setRecs(found)
      setStatus(found.length ? 'ready' : 'empty')
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeds])

  function skip(m: Movie) {
    dismissRec('movie', m.id, m.title, m.poster_url)
    setRecs((prev) => prev.filter((x) => x.id !== m.id))
  }

  const visible = recs.filter((m) => !isDismissed('movie', m.id))

  if (status === 'idle') return null

  return (
    <section>
      <h2 className="section-title">Recommandé pour toi</h2>
      {status === 'loading' && <p className="muted">Recherche de suggestions…</p>}
      {status === 'empty' && (
        <p className="muted">TMDB n'a rien à te proposer pour l'instant à partir de tes derniers films vus.</p>
      )}
      {status === 'ready' && (
        <ul className="shelf shelf--carousel">
          {visible.map((m) => (
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
  const { tracked, isDismissed, dismissRec } = useApp()
  const { data } = useShowEpisodes(showIds)
  const [recs, setRecs] = useState<TvRecommendation[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [opening, setOpening] = useState<number | null>(null)
  const [notFound, setNotFound] = useState<number | null>(null)
  // Toutes les séries jamais suivies, pas seulement les 3 servant de base aux
  // suggestions : une série vue puis retirée du suivi ne doit pas revenir.
  const trackedNames = useMemo(
    () => new Set(tracked.map((t) => normalizeTitle(t.name))),
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
            trackedNames.has(normalizeTitle(r.name)) || trackedNames.has(normalizeTitle(r.originalName))
          if (!alreadyTracked && !byId.has(r.id)) {
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
        .slice(0, 20)
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
      // TVmaze indexe (presque) toujours sous le titre original : le titre
      // TMDB est souvent en français et n'y donne rien.
      let results = await searchShows(r.name)
      if (!results.length && r.originalName !== r.name) {
        results = await searchShows(r.originalName)
      }
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
    dismissRec('show', r.id, r.name, r.poster_url)
    setRecs((prev) => prev.filter((x) => x.id !== r.id))
  }

  const visible = recs.filter((r) => !isDismissed('show', r.id))

  if (status === 'idle') return null

  return (
    <section>
      <h2 className="section-title">Recommandé pour toi</h2>
      {status === 'loading' && <p className="muted">Recherche de suggestions…</p>}
      {status === 'empty' && (
        <p className="muted">TMDB n'a rien à te proposer pour l'instant à partir de tes séries les plus actives.</p>
      )}
      {status === 'ready' && (
        <ul className="shelf shelf--carousel">
          {visible.map((r) => (
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

/**
 * Ce qui est populaire sur Netflix en ce moment, indépendant de ce qu'on a
 * regardé — contrairement à « Recommandé pour toi », toujours affiché tant
 * que TMDB répond. Même mécanisme d'écart (et de mémoire partagée) que les
 * suggestions personnalisées.
 */
export function NetflixTopMovies() {
  const { movies, isDismissed, dismissRec, loading } = useApp()
  // La liste brute vient d'un seul appel TMDB (indépendant de la bibliothèque),
  // mais le filtre « déjà vu » doit rester à jour même si la bibliothèque finit
  // de charger après ce premier appel : recalculé à chaque rendu plutôt que
  // figé dans l'effet qui, lui, ne tourne qu'une fois. On attend aussi que le
  // chargement soit fini pour éviter un flash de titres pas encore filtrés.
  const [raw, setRaw] = useState<Movie[]>([])
  const [status, setStatus] = useState<Status>('idle')

  useEffect(() => {
    if (!tmdbConfigured || loading) return
    let alive = true
    setStatus('loading')
    netflixTopMovies().then((found) => {
      if (!alive) return
      setRaw(found)
      setStatus(found.length ? 'ready' : 'empty')
    })
    return () => {
      alive = false
    }
  }, [loading])

  function skip(m: Movie) {
    dismissRec('movie', m.id, m.title, m.poster_url)
    setRaw((prev) => prev.filter((x) => x.id !== m.id))
  }

  const known = useMemo(() => new Set(movies.map((m) => m.movie_id)), [movies])
  const visible = raw.filter((m) => !known.has(m.id) && !isDismissed('movie', m.id))

  if (status === 'idle' || status === 'empty' || !visible.length) return null

  return (
    <section>
      <h2 className="section-title">Populaire sur Netflix</h2>
      <ul className="shelf shelf--carousel">
        {visible.map((m) => (
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
    </section>
  )
}

/** Équivalent séries de NetflixTopMovies : même logique, résolution TVmaze au clic. */
export function NetflixTopShows() {
  const { tracked, isDismissed, dismissRec, loading } = useApp()
  // Même remarque que NetflixTopMovies : le filtre « déjà suivie » doit
  // rester à jour même si la bibliothèque finit de charger après le premier
  // appel TMDB — recalculé à chaque rendu, pas figé dans l'effet.
  const [raw, setRaw] = useState<TvRecommendation[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [opening, setOpening] = useState<number | null>(null)
  const [notFound, setNotFound] = useState<number | null>(null)
  const trackedNames = useMemo(
    () => new Set(tracked.map((t) => normalizeTitle(t.name))),
    [tracked],
  )

  useEffect(() => {
    // Attend que la bibliothèque ait fini de charger : sinon le premier
    // rendu filtre avec un ensemble vide, affiche tout sans distinction,
    // puis fait disparaître d'un coup les titres déjà suivis une fois les
    // vraies données arrivées — un clignotement, pas un vrai comportement.
    if (!tmdbConfigured || loading) return
    let alive = true
    setStatus('loading')
    netflixTopShows().then((found) => {
      if (!alive) return
      setRaw(found)
      setStatus(found.length ? 'ready' : 'empty')
    })
    return () => {
      alive = false
    }
  }, [loading])

  async function open(r: TvRecommendation) {
    setNotFound(null)
    setOpening(r.id)
    try {
      // TVmaze indexe (presque) toujours sous le titre original : le titre
      // TMDB est souvent en français et n'y donne rien.
      let results = await searchShows(r.name)
      if (!results.length && r.originalName !== r.name) {
        results = await searchShows(r.originalName)
      }
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
    dismissRec('show', r.id, r.name, r.poster_url)
    setRaw((prev) => prev.filter((x) => x.id !== r.id))
  }

  const visible = raw.filter(
    (r) =>
      !trackedNames.has(normalizeTitle(r.name)) &&
      !trackedNames.has(normalizeTitle(r.originalName)) &&
      !isDismissed('show', r.id),
  )

  if (status === 'idle' || status === 'empty' || !visible.length) return null

  return (
    <section>
      <h2 className="section-title">Populaire sur Netflix</h2>
      <ul className="shelf shelf--carousel">
        {visible.map((r) => (
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
    </section>
  )
}
