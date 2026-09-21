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
  /** `dates` (import) fixe la date de visionnage épisode par épisode. */
  setWatched: (
    show: TvShow,
    eps: TvEpisode[],
    value: boolean,
    dates?: Map<number, string | null>,
    /** Réécrit la date des épisodes déjà cochés au lieu de les laisser tels quels. */
    overwrite?: boolean,
  ) => Promise<void>
  addMovies: (items: { movie: Movie; watchedAt: string | null }[]) => Promise<void>
  removeMovie: (movieId: number) => Promise<void>
  /** Relève chez TMDB la durée des films qui n'en ont pas encore. */
  fillMovieRuntimes: (onProgress?: (done: number, total: number) => void) => Promise<void>
}

const Ctx = createContext<AppState | null>(null)
const EMPTY: WatchedEpisodes = new Map()

export function AppProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [tracked, setTracked] = useState<TrackedShow[]>([])
  const [watched, setWatchedMap] = useState<WatchedMap>(new Map())
  const [movies, setMovies] = useState<WatchedMovie[]>([])
  const [moviesReady, setMoviesReady] = useState(true)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    // Les séries sont le cœur de l'app : leur chargement ne doit pas dépendre
    // des films, dont la table peut manquer si le schéma n'a pas été migré.
    Promise.all([store.fetchTracked(), store.fetchWatched()])
      .then(([t, w]) => {
        if (!alive) return
        setTracked(t)
        setWatchedMap(w)
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
  const watchedFor = useCallback((id: number) => watched.get(id) ?? EMPTY, [watched])
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

  const setWatched = useCallback(
    async (
      show: TvShow,
      eps: TvEpisode[],
      value: boolean,
      dates?: Map<number, string | null>,
      overwrite = false,
    ) => {
      if (!eps.length) return
      const ids = eps.map((e) => e.id)
      const now = new Date().toISOString()
      const apply = (on: boolean) =>
        setWatchedMap((prev) => {
          const next = new Map(prev)
          const eps = new Map(prev.get(show.id) ?? [])
          ids.forEach((id) => (on ? eps.set(id, dates ? (dates.get(id) ?? null) : now) : eps.delete(id)))
          next.set(show.id, eps)
          return next
        })

      apply(value) // mise à jour optimiste
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
      }
      try {
        if (value) {
          if (!tracked.some((t) => t.show_id === show.id)) await track(show)
          await store.markWatched(userId, show.id, eps, dates, overwrite)
        } else {
          await store.markUnwatched(ids)
        }
      } catch (e) {
        apply(!value)
        setNotice(`Enregistrement impossible : ${(e as Error).message}`)
      }
    },
    [track, tracked, userId],
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
              watched_at: watchedAt,
              runtime,
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
      isTracked, statusOf, watchedFor, track, untrack, setStatus, setWatched,
      addMovies, removeMovie, fillMovieRuntimes,
    }),
    [userId, tracked, watched, movies, moviesReady, loading, notice, isTracked, statusOf, watchedFor,
     track, untrack, setStatus, setWatched, addMovies, removeMovie, fillMovieRuntimes],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp doit être utilisé dans <AppProvider>')
  return ctx
}
