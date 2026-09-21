import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as store from './store'
import type { ShowStatus, TrackedShow, WatchedMap, WatchedMovie } from './store'
import { movieRuntime, type Movie } from './tmdb'
import type { TvEpisode, TvShow } from './tvmaze'

/**
 * Épisodes vus d'une série : identifiant → date de visionnage (ISO), ou null
 * quand elle est inconnue. La présence de la clé signifie « vu » ; sa valeur
 * ne dit que le quand.
 */
export type WatchedEpisodes = ReadonlyMap<number, string | null>

type AppState = {
  userId: string
  tracked: TrackedShow[]
  watched: WatchedMap
  movies: WatchedMovie[]
  /** Faux tant que `supabase/schema.sql` n'a pas été relancé : pas de table films. */
  moviesReady: boolean
  loading: boolean
  notice: string | null
  dismissNotice: () => void
  isTracked: (showId: number) => boolean
  statusOf: (showId: number) => ShowStatus
  watchedFor: (showId: number) => WatchedEpisodes
  track: (show: TvShow) => Promise<void>
  untrack: (showId: number) => Promise<void>
  setStatus: (showId: number, status: ShowStatus) => Promise<void>
  /** Nombre de revisionnages complets d'une série, en plus du premier. */
  rewatchesOf: (showId: number) => number
  setRewatches: (showId: number, count: number) => Promise<void>
  /** Un revisionnage est-il en cours sur cette série ? */
  isRewatching: (showId: number) => boolean
  /** Progression historique, indépendante du revisionnage en cours. */
  historyFor: (showId: number) => WatchedEpisodes
  startRewatch: (showId: number) => Promise<void>
  /** `completed` incrémente le compteur ; sinon le revisionnage est abandonné. */
  endRewatch: (showId: number, completed: boolean) => Promise<void>
  /** `dates` (import) fixe la date de visionnage épisode par épisode. */
  setWatched: (
    show: TvShow,
    eps: TvEpisode[],
    value: boolean,
    dates?: Map<number, string | null>,
    /** Réécrit la date des épisodes déjà cochés au lieu de les laisser tels quels. */
    overwrite?: boolean,
    /** Force l'écriture dans l'historique même si un revisionnage est en cours. */
    toHistory?: boolean,
  ) => Promise<void>
  addMovies: (items: { movie: Movie; watchedAt: string | null }[]) => Promise<void>
  /** Ajoute un film à la liste « à voir », sans date : il n'est pas encore vu. */
  addToWatchlist: (movie: Movie) => Promise<void>
  /** Bascule un film « à voir » sur « vu », à la date donnée (ou inconnue). */
  markMovieWatched: (movieId: number, watchedAt: string | null) => Promise<void>
  markMovieUnwatched: (movieId: number) => Promise<void>
  removeMovie: (movieId: number) => Promise<void>
  /** Relève chez TMDB la durée des films qui n'en ont pas encore. */
  fillMovieRuntimes: (onProgress?: (done: number, total: number) => void) => Promise<void>
  /** Complète l'affiche et/ou la durée d'un film depuis sa fiche détail, si l'un des deux manque. */
  fillMovieMeta: (movieId: number, patch: { poster_url?: string; runtime?: number; release_date?: string }) => Promise<void>
  /** Recale `last_watched_at` sur la vraie date, quand le diagnostic en trouve un décalage. */
  fixActivity: (showId: number, actual: string | null) => Promise<void>
}

const Ctx = createContext<AppState | null>(null)
const EMPTY: WatchedEpisodes = new Map()

export function AppProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [tracked, setTracked] = useState<TrackedShow[]>([])
  const [watched, setWatchedMap] = useState<WatchedMap>(new Map())
  const [rewatch, setRewatch] = useState<WatchedMap>(new Map())
  const [movies, setMovies] = useState<WatchedMovie[]>([])
  const [moviesReady, setMoviesReady] = useState(true)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    // Les séries sont le cœur de l'app : leur chargement ne doit pas dépendre
    // des films, dont la table peut manquer si le schéma n'a pas été migré.
    Promise.all([store.fetchTracked(), store.fetchWatched(), store.fetchRewatchProgress()])
      .then(([t, w, r]) => {
        if (!alive) return
        setTracked(t)
        setWatchedMap(w)
        setRewatch(r)
      })
      .catch((e) => alive && setNotice(`Chargement impossible : ${e.message}`))
      .finally(() => alive && setLoading(false))

    store
      .fetchMovies()
      .then((m) => alive && setMovies(m))
      .catch((e) => {
        if (!alive) return
        if (store.isMissingSchema(e)) setMoviesReady(false)
        else setNotice(`Chargement des films impossible : ${e.message}`)
      })
    return () => {
      alive = false
    }
  }, [userId])

  const isTracked = useCallback((id: number) => tracked.some((t) => t.show_id === id), [tracked])
  const isRewatching = useCallback(
    (id: number) => tracked.find((t) => t.show_id === id)?.rewatching ?? false,
    [tracked],
  )
  const historyFor = useCallback((id: number) => watched.get(id) ?? EMPTY, [watched])
  // Pendant un revisionnage, toute l'interface (grille, prochain épisode,
  // accueil) doit lire la passe en cours, pas l'historique.
  const watchedFor = useCallback(
    (id: number) => (isRewatching(id) ? rewatch.get(id) ?? EMPTY : watched.get(id) ?? EMPTY),
    [isRewatching, rewatch, watched],
  )
  const statusOf = useCallback(
    (id: number) => tracked.find((t) => t.show_id === id)?.status ?? 'watching',
    [tracked],
  )

  const track = useCallback(
    async (show: TvShow) => {
      if (tracked.some((t) => t.show_id === show.id)) return
      try {
        const row = await store.trackShow(userId, show)
        setTracked((prev) => (prev.some((t) => t.show_id === show.id) ? prev : [row, ...prev]))
      } catch (e) {
        setNotice(`Impossible d'ajouter ${show.name} : ${(e as Error).message}`)
      }
    },
    [tracked, userId],
  )

  const untrack = useCallback(async (showId: number) => {
    try {
      await store.untrackShow(showId)
      setTracked((prev) => prev.filter((t) => t.show_id !== showId))
      setWatchedMap((prev) => {
        const next = new Map(prev)
        next.delete(showId)
        return next
      })
    } catch (e) {
      setNotice(`Suppression impossible : ${(e as Error).message}`)
    }
  }, [])

  const setStatus = useCallback(async (showId: number, status: ShowStatus) => {
    const before = new Map<number, ShowStatus>()
    setTracked((prev) =>
      prev.map((t) => {
        if (t.show_id !== showId) return t
        before.set(showId, t.status)
        return { ...t, status }
      }),
    )
    try {
      await store.setShowStatus(showId, status)
    } catch (e) {
      const old = before.get(showId)
      if (old) setTracked((prev) => prev.map((t) => (t.show_id === showId ? { ...t, status: old } : t)))
      setNotice(`Changement de statut impossible : ${(e as Error).message}`)
    }
  }, [])

  const rewatchesOf = useCallback(
    (id: number) => tracked.find((t) => t.show_id === id)?.rewatches ?? 0,
    [tracked],
  )

  const setRewatches = useCallback(async (showId: number, count: number) => {
    const next = Math.max(0, Math.round(count))
    let previous = 0
    setTracked((prev) =>
      prev.map((t) => {
        if (t.show_id !== showId) return t
        previous = t.rewatches
        return { ...t, rewatches: next }
      }),
    )
    try {
      await store.setRewatches(showId, next)
    } catch (e) {
      setTracked((prev) =>
        prev.map((t) => (t.show_id === showId ? { ...t, rewatches: previous } : t)),
      )
      setNotice(`Enregistrement du revisionnage impossible : ${(e as Error).message}`)
    }
  }, [])

  const patchShow = useCallback((showId: number, patch: Partial<TrackedShow>) => {
    setTracked((prev) => prev.map((t) => (t.show_id === showId ? { ...t, ...patch } : t)))
  }, [])

  const startRewatch = useCallback(
    async (showId: number) => {
      patchShow(showId, { rewatching: true })
      setRewatch((prev) => {
        const next = new Map(prev)
        next.delete(showId)
        return next
      })
      try {
        // Une passe abandonnée a pu laisser des lignes : on repart de zéro.
        await store.clearRewatchProgress(showId)
        await store.setRewatching(showId, true)
      } catch (e) {
        patchShow(showId, { rewatching: false })
        setNotice(`Impossible de démarrer le revisionnage : ${(e as Error).message}`)
      }
    },
    [patchShow],
  )

  const endRewatch = useCallback(
    async (showId: number, completed: boolean) => {
      const before = tracked.find((t) => t.show_id === showId)
      const next = (before?.rewatches ?? 0) + (completed ? 1 : 0)
      patchShow(showId, { rewatching: false, rewatches: next })
      setRewatch((prev) => {
        const m = new Map(prev)
        m.delete(showId)
        return m
      })
      try {
        if (completed) await store.setRewatches(showId, next)
        await store.setRewatching(showId, false)
        await store.clearRewatchProgress(showId)
      } catch (e) {
        if (before) patchShow(showId, { rewatching: true, rewatches: before.rewatches })
        setNotice(`Impossible de clore le revisionnage : ${(e as Error).message}`)
      }
    },
    [patchShow, tracked],
  )

  const setWatched = useCallback(
    async (
      show: TvShow,
      eps: TvEpisode[],
      value: boolean,
      dates?: Map<number, string | null>,
      overwrite = false,
      toHistory = false,
    ) => {
      if (!eps.length) return
      const ids = eps.map((e) => e.id)
      const now = new Date().toISOString()

      // Pendant un revisionnage, on coche dans la passe en cours : l'historique
      // reste intact, et décocher ne perd rien du premier visionnage.
      //
      // Un import est l'exception : il apporte du passé, pas la passe du soir.
      // Sans ce garde-fou, importer pendant un revisionnage y déverserait la
      // série entière et la clorait d'un coup.
      if (isRewatching(show.id) && !toHistory) {
        const applyRewatch = (on: boolean) =>
          setRewatch((prev) => {
            const next = new Map(prev)
            const eps = new Map(prev.get(show.id) ?? [])
            ids.forEach((id) => {
              if (!on) { eps.delete(id); return }
              eps.set(id, dates ? (dates.get(id) ?? null) : now)
            })
            next.set(show.id, eps)
            return next
          })
        applyRewatch(value)
        // Cocher, décocher ou corriger une date pendant un revisionnage est
        // une vraie activité : sans mise à jour de last_watched_at, la série
        // ne bougerait jamais dans l'accueil pendant qu'on la revoit — y
        // compris à la baisse si on décoche par erreur, ou si une correction
        // de date recule la plus récente connue.
        const currentPass = new Map(rewatch.get(show.id) ?? [])
        ids.forEach((id) => {
          if (!value) { currentPass.delete(id); return }
          currentPass.set(id, dates ? (dates.get(id) ?? null) : now)
        })
        let last: string | null = null
        currentPass.forEach((d) => { if (d && (!last || d > last)) last = d })
        // Plus rien de daté dans cette passe : on retombe sur le dernier
        // visionnage historique, pas sur « aucune activité ».
        if (!last) {
          const hist = watched.get(show.id)
          last = hist
            ? [...hist.values()].reduce<string | null>((max, d) => (d && (!max || d > max) ? d : max), null)
            : null
        }
        setTracked((prev) => prev.map((t) => (t.show_id === show.id ? { ...t, last_watched_at: last } : t)))
        try {
          if (value) await store.markRewatched(userId, show.id, eps, dates, overwrite)
          else await store.unmarkRewatched(ids)
          await store.touchLastWatched(show.id, last)
        } catch (e) {
          applyRewatch(!value)
          setNotice(`Enregistrement impossible : ${(e as Error).message}`)
        }
        return
      }

      const apply = (on: boolean) =>
        setWatchedMap((prev) => {
          const next = new Map(prev)
          const eps = new Map(prev.get(show.id) ?? [])
          ids.forEach((id) => (on ? eps.set(id, dates ? (dates.get(id) ?? null) : now) : eps.delete(id)))
          next.set(show.id, eps)
          return next
        })

      apply(value) // mise à jour optimiste
      let uncheckedLastWatched: string | null | undefined
      if (value) {
        // Une reprise sans date ne remonte pas la série en tête de liste.
        const last = ids.reduce<string | null>((max, id) => {
          const d = dates ? dates.get(id) ?? null : now
          return d && (!max || d > max) ? d : max
        }, null)
        if (last) {
          setTracked((prev) =>
            prev.map((t) => (t.show_id === show.id ? { ...t, last_watched_at: last } : t)),
          )
        }
      } else {
        // Décocher ce qui était en fait la date la plus récente doit faire
        // retomber la série à sa vraie dernière activité, pas la laisser
        // en tête sur une date qui ne correspond plus à rien de coché.
        const remaining = watched.get(show.id) ?? new Map()
        let last: string | null = null
        remaining.forEach((d, epId) => {
          if (ids.includes(epId)) return
          if (d && (!last || d > last)) last = d
        })
        uncheckedLastWatched = last
        setTracked((prev) =>
          prev.map((t) => (t.show_id === show.id ? { ...t, last_watched_at: last } : t)),
        )
      }
      // Un premier épisode coché sort la série de « à voir » : elle est
      // maintenant commencée, pas juste projetée.
      const wasNotStarted = tracked.find((t) => t.show_id === show.id)?.status === 'later'
      if (value && wasNotStarted) {
        setTracked((prev) =>
          prev.map((t) => (t.show_id === show.id ? { ...t, status: 'watching' } : t)),
        )
      }
      try {
        if (value) {
          if (!tracked.some((t) => t.show_id === show.id)) await track(show)
          if (wasNotStarted) await store.setShowStatus(show.id, 'watching')
          await store.markWatched(userId, show.id, eps, dates, overwrite)
        } else {
          await store.markUnwatched(ids)
          await store.touchLastWatched(show.id, uncheckedLastWatched ?? null)
        }
      } catch (e) {
        apply(!value)
        if (wasNotStarted) {
          setTracked((prev) =>
            prev.map((t) => (t.show_id === show.id ? { ...t, status: 'later' } : t)),
          )
        }
        setNotice(`Enregistrement impossible : ${(e as Error).message}`)
      }
    },
    [isRewatching, track, tracked, userId, watched, rewatch],
  )

  const addMovies = useCallback(
    async (items: { movie: Movie; watchedAt: string | null }[]) => {
      if (!items.length) return
      if (!moviesReady) {
        setNotice("Films indisponibles : relance supabase/schema.sql dans ton projet Supabase.")
        return
      }
      try {
        // Une requête de détail par film pour connaître sa durée. Un échec ici
        // ne doit pas empêcher d'enregistrer le film : la durée se rattrape.
        const withRuntime = await Promise.all(
          items.map(async (i) => ({
            ...i,
            runtime: await movieRuntime(i.movie.id).catch(() => null),
          })),
        )
        await store.addMovies(userId, withRuntime)
        setMovies((prev) => {
          const byId = new Map(prev.map((m) => [m.movie_id, m]))
          for (const { movie, watchedAt, runtime } of withRuntime) {
            if (byId.has(movie.id)) continue
            byId.set(movie.id, {
              movie_id: movie.id,
              title: movie.title,
              poster_url: movie.poster_url,
              release_year: movie.year,
              release_date: movie.release_date,
              watched_at: watchedAt,
              runtime,
              status: 'watched',
            })
          }
          // Les films sans date passent en fin de liste.
          return [...byId.values()].sort((a, b) => (b.watched_at ?? '').localeCompare(a.watched_at ?? ''))
        })
      } catch (e) {
        setNotice(`Enregistrement du film impossible : ${(e as Error).message}`)
      }
    },
    [moviesReady, userId],
  )

  const fillMovieRuntimes = useCallback(
    async (onProgress?: (done: number, total: number) => void) => {
      const missing = movies.filter((m) => m.runtime == null)
      if (!missing.length) return
      const found: { movie_id: number; runtime: number }[] = []
      for (const [i, m] of missing.entries()) {
        try {
          const runtime = await movieRuntime(m.movie_id)
          if (runtime !== null) found.push({ movie_id: m.movie_id, runtime })
        } catch {
          /* un film sans durée relevable reste sans durée */
        }
        onProgress?.(i + 1, missing.length)
      }
      if (!found.length) return
      try {
        await store.setMovieRuntimes(found)
        const byId = new Map(found.map((f) => [f.movie_id, f.runtime]))
        setMovies((prev) =>
          prev.map((m) => (byId.has(m.movie_id) ? { ...m, runtime: byId.get(m.movie_id)! } : m)),
        )
      } catch (e) {
        setNotice(`Mise à jour des durées impossible : ${(e as Error).message}`)
      }
    },
    [movies],
  )

  /**
   * Complète l'affiche et/ou la durée d'un film directement depuis sa fiche
   * détail, quand l'un des deux manque encore (film ajouté sans passer par
   * l'app) — silencieux en cas d'échec, ce n'est qu'un complément.
   */
  const fillMovieMeta = useCallback(async (movieId: number, patch: { poster_url?: string; runtime?: number; release_date?: string }) => {
    if (!Object.keys(patch).length) return
    setMovies((prev) => prev.map((m) => (m.movie_id === movieId ? { ...m, ...patch } : m)))
    try {
      await store.fillMovieMeta(movieId, patch)
    } catch {
      /* un complément manqué n'est pas grave, on retentera à la prochaine visite */
    }
  }, [])

  const fixActivity = useCallback(async (showId: number, actual: string | null) => {
    const before = tracked.find((t) => t.show_id === showId)?.last_watched_at ?? null
    patchShow(showId, { last_watched_at: actual })
    try {
      await store.touchLastWatched(showId, actual)
    } catch (e) {
      patchShow(showId, { last_watched_at: before })
      setNotice(`Correction impossible : ${(e as Error).message}`)
    }
  }, [tracked, patchShow])

  const addToWatchlist = useCallback(
    async (movie: Movie) => {
      if (!moviesReady) {
        setNotice("Films indisponibles : relance supabase/schema.sql dans ton projet Supabase.")
        return
      }
      if (movies.some((m) => m.movie_id === movie.id)) return
      const row: WatchedMovie = {
        movie_id: movie.id,
        title: movie.title,
        poster_url: movie.poster_url,
        release_year: movie.year,
        release_date: movie.release_date,
        watched_at: null,
        runtime: null,
        status: 'later',
      }
      setMovies((prev) => [row, ...prev])
      try {
        await store.addToWatchlist(userId, movie)
      } catch (e) {
        setMovies((prev) => prev.filter((m) => m.movie_id !== movie.id))
        setNotice(`Ajout à voir impossible : ${(e as Error).message}`)
      }
    },
    [moviesReady, movies, userId],
  )

  const markMovieWatched = useCallback(
    async (movieId: number, watchedAt: string | null) => {
      const before = movies.find((m) => m.movie_id === movieId)
      setMovies((prev) =>
        prev.map((m) => (m.movie_id === movieId ? { ...m, status: 'watched', watched_at: watchedAt } : m)),
      )
      try {
        await store.markMovieWatched(movieId, watchedAt)
      } catch (e) {
        if (before) setMovies((prev) => prev.map((m) => (m.movie_id === movieId ? before : m)))
        setNotice(`Enregistrement impossible : ${(e as Error).message}`)
      }
    },
    [movies],
  )

  const markMovieUnwatched = useCallback(
    async (movieId: number) => {
      const before = movies.find((m) => m.movie_id === movieId)
      setMovies((prev) =>
        prev.map((m) => (m.movie_id === movieId ? { ...m, status: 'later', watched_at: null } : m)),
      )
      try {
        await store.markMovieUnwatched(movieId)
      } catch (e) {
        if (before) setMovies((prev) => prev.map((m) => (m.movie_id === movieId ? before : m)))
        setNotice(`Enregistrement impossible : ${(e as Error).message}`)
      }
    },
    [movies],
  )

  const removeMovie = useCallback(async (movieId: number) => {
    const snapshot = movies
    setMovies((prev) => prev.filter((m) => m.movie_id !== movieId))
    try {
      await store.removeMovie(movieId)
    } catch (e) {
      setMovies(snapshot)
      setNotice(`Suppression impossible : ${(e as Error).message}`)
    }
  }, [movies])

  const value = useMemo<AppState>(
    () => ({
      userId, tracked, watched, movies, moviesReady, loading, notice,
      dismissNotice: () => setNotice(null),
      isTracked, statusOf, watchedFor, historyFor, rewatchesOf, setRewatches,
      isRewatching, startRewatch, endRewatch,
      track, untrack, setStatus, setWatched,
      addMovies, addToWatchlist, markMovieWatched, markMovieUnwatched, removeMovie, fillMovieRuntimes, fillMovieMeta, fixActivity,
    }),
    [userId, tracked, watched, rewatch, movies, moviesReady, loading, notice, isTracked, statusOf, watchedFor,
     historyFor, rewatchesOf, setRewatches, isRewatching, startRewatch, endRewatch,
     track, untrack, setStatus, setWatched, addMovies, addToWatchlist, markMovieWatched, markMovieUnwatched, removeMovie, fillMovieRuntimes, fillMovieMeta, fixActivity],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp doit être utilisé dans <AppProvider>')
  return ctx
}
