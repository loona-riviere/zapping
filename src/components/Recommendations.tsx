import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../lib/appState'
import { dismiss, isDismissed } from '../lib/dismissed'
import {
  movieRecommendations, tmdbConfigured, tvRecommendationsByImdb,
  type Movie, type TvRecommendation,
} from '../lib/tmdb'
import { searchShows } from '../lib/tvmaze'
import { useShowEpisodes } from '../lib/useShows'
import { Poster } from './Poster'

type Status = 'idle' | 'loading' | 'empty' | 'ready'

/**
 * Modale « Intéressé·e ? » commune aux deux types de suggestion : oui ajoute
 * à la liste à voir, non l'écarte pour de bon (persisté via `dismissed.ts`).
 */
function RecModal({
  title, image, year, onYes, onNo, onClose, busy, error,
}: {
  title: string
  image: string | null
  year: number | null
  onYes: () => void
  onNo: () => void
  onClose: () => void
  busy?: boolean
  error?: string
}) {
  return (
    <div className="catchup catchup--rec" role="dialog" aria-modal="true">
      <div className="catchup__pick">
        <Poster src={image} alt={title} />
        <div>
          <p className="catchup__title">{title}</p>
          {year && <p className="muted">{year}</p>}
        </div>
      </div>
      <p>Intéressé·e ?</p>
      {error && <p className="error">{error}</p>}
      <div className="catchup__actions">
        <button className="btn btn--ghost" onClick={onNo} disabled={busy}>Non, ne plus proposer</button>
        <button className="btn btn--primary" onClick={onYes} disabled={busy}>
          {busy ? 'Ajout…' : 'Oui, à voir'}
        </button>
      </div>
      <button type="button" className="link-btn catchup__close" onClick={onClose}>Fermer</button>
    </div>
  )
}

/**
 * Suggestions de films à partir des derniers vus, via les recommandations
 * TMDB. Cliquer ouvre une modale : oui ajoute à « à voir », non écarte la
 * suggestion pour de bon.
 */
export function MovieRecommendations() {
  const { movies, addToWatchlist } = useApp()
  const [recs, setRecs] = useState<Movie[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [picked, setPicked] = useState<Movie | null>(null)

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

  function confirmYes() {
    if (!picked) return
    addToWatchlist(picked)
    setRecs((prev) => prev.filter((m) => m.id !== picked.id))
    setPicked(null)
  }

  function confirmNo() {
    if (!picked) return
    dismiss('movie', picked.id)
    setRecs((prev) => prev.filter((m) => m.id !== picked.id))
    setPicked(null)
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
            <li key={m.id}>
              <button type="button" className="shelf__pick" onClick={() => setPicked(m)} title={m.title}>
                <Poster src={m.poster_url} alt={m.title} />
                <span className="shelf__label">{m.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <RecModal
          title={picked.title}
          image={picked.poster_url}
          year={picked.year}
          onYes={confirmYes}
          onNo={confirmNo}
          onClose={() => setPicked(null)}
        />
      )}
    </section>
  )
}

/**
 * Suggestions de séries à partir des séries suivies les plus actives. TMDB
 * ne connaît pas les identifiants TVmaze : sur « oui », on cherche le titre
 * chez TVmaze (le meilleur résultat, ou celui dont l'année colle) pour la
 * suivre directement — sans résultat, on prévient plutôt que de deviner.
 */
export function ShowRecommendations({ showIds }: { showIds: number[] }) {
  const { tracked, track } = useApp()
  const { data } = useShowEpisodes(showIds)
  const [recs, setRecs] = useState<TvRecommendation[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [picked, setPicked] = useState<TvRecommendation | null>(null)
  const [busy, setBusy] = useState(false)
  const [notFound, setNotFound] = useState(false)
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
          if (!trackedNames.has(r.name.toLowerCase()) && !isDismissed('show', r.id) && !byId.has(r.id)) {
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

  function pick(r: TvRecommendation) {
    setNotFound(false)
    setPicked(r)
  }

  async function confirmYes() {
    if (!picked) return
    setBusy(true)
    setNotFound(false)
    try {
      const results = await searchShows(picked.name)
      const match =
        results.find((s) => picked.year && s.premiered && Number(s.premiered.slice(0, 4)) === picked.year) ??
        results[0]
      if (!match) {
        setNotFound(true)
        return
      }
      await track(match)
      setRecs((prev) => prev.filter((r) => r.id !== picked.id))
      setPicked(null)
    } finally {
      setBusy(false)
    }
  }

  function confirmNo() {
    if (!picked) return
    dismiss('show', picked.id)
    setRecs((prev) => prev.filter((r) => r.id !== picked.id))
    setPicked(null)
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
            <li key={r.id}>
              <button type="button" className="shelf__pick" onClick={() => pick(r)} title={r.name}>
                <Poster src={r.poster_url} alt={r.name} />
                <span className="shelf__label">{r.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <RecModal
          title={picked.name}
          image={picked.poster_url}
          year={picked.year}
          onYes={confirmYes}
          onNo={confirmNo}
          onClose={() => setPicked(null)}
          busy={busy}
          error={notFound ? "Introuvable chez TVmaze sous ce titre — cherche-la à la main." : undefined}
        />
      )}
    </section>
  )
}
