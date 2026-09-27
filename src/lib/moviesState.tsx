import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as store from './store'
import type { Rating, WatchedMovie } from './store'
import { movieRuntime, type Movie } from './tmdb'
import { celebrate, checkMilestone, nightOwl } from './fun'
import { failure, useShowNotice } from './notice'
import { useLatest } from './useLatest'

export type MoviesState = {
  movies: WatchedMovie[]
  /** Faux tant que `supabase/schema.sql` n'a pas été relancé : pas de table films. */
  moviesReady: boolean
  moviesLoading: boolean
  addMovies: (items: { movie: Movie; watchedAt: string | null }[]) => Promise<void>
  /** Ajoute un film à la liste « à voir », sans date : il n'est pas encore vu. */
  addToWatchlist: (movie: Movie) => Promise<void>
  /** Bascule un film « à voir » sur « vu », à la date donnée (ou inconnue). */
  markMovieWatched: (movieId: number, watchedAt: string | null) => Promise<void>
  markMovieUnwatched: (movieId: number) => Promise<void>
  /** Revu : ajoute un visionnage à la date donnée, les précédents sont gardés. */
  rewatchMovie: (movieId: number, at: string) => Promise<void>
  /** Réécrit tous les visionnages d'un film : le plus récent et ceux d'avant. */
  setMovieViews: (movieId: number, watchedAt: string | null, past: (string | null)[]) => Promise<void>
  /** Oublie un visionnage d'avant (index dans past_views). */
  removePastView: (movieId: number, index: number) => Promise<void>
  /** Amis présents au dernier visionnage d'un film. */
  setMovieWith: (movieId: number, ids: string[]) => Promise<void>
  removeMovie: (movieId: number) => Promise<void>
  /** Annule un retrait : remet le film tel qu'il était. */
  restoreMovie: (movie: WatchedMovie) => Promise<void>
  /** Faux tant que `supabase/schema.sql` n'a pas été relancé : pas de colonne wish_rank. */
  movieRanksReady: boolean
  /** Range « à voir » dans l'ordre d'envie donné (identifiants). */
  reorderMovies: (orderedIds: number[]) => Promise<void>
  /** Relève chez TMDB la durée des films qui n'en ont pas encore. */
  fillMovieRuntimes: (onProgress?: (done: number, total: number) => void) => Promise<void>
  /** Complète l'affiche et/ou la durée d'un film depuis sa fiche détail, si l'un des deux manque. */
  fillMovieMeta: (movieId: number, patch: { poster_url?: string; runtime?: number; release_date?: string }) => Promise<void>
  rateMovie: (movieId: number, rating: Rating | null) => Promise<void>
}

const Ctx = createContext<MoviesState | null>(null)

const MOVIE_CHEERS = [
  (t: string) => `🍿 ${t} : vu ! Alors, verdict ?`,
  (t: string) => `🎬 ${t} : c'est dans la boîte.`,
  (t: string) => `🍿 ${t} : un de plus au compteur !`,
]
const movieCheer = (title: string) => MOVIE_CHEERS[Math.floor(Math.random() * MOVIE_CHEERS.length)](title)
const MISSING_TABLE = 'Films indisponibles : relance supabase/schema.sql dans ton projet Supabase.'

export function MoviesProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const showNotice = useShowNotice()
  const [movies, setMovies] = useState<WatchedMovie[]>([])
  const [moviesReady, setMoviesReady] = useState(true)
  const [moviesLoading, setMoviesLoading] = useState(true)
  const [movieRanksReady, setRanksReady] = useState(true)
  const moviesRef = useLatest(movies)
  const findMovie = useCallback((id: number) => moviesRef.current.find((m) => m.movie_id === id), [moviesRef])

  useEffect(() => {
    let alive = true
    store
      .fetchMovies()
      .then(async (m) => {
        if (!alive) return
        setMovies(m)
        setMoviesLoading(false)
        // Rangs d'envie, lus à part : la colonne peut manquer sans empêcher le reste.
        const ranks = await store.fetchRanks('watched_movies').catch(() => undefined)
        if (!alive || ranks === undefined) return // indisponible pour cette fois
        if (!ranks) setRanksReady(false)
        else setMovies((prev) => prev.map((x) => ({ ...x, wish_rank: ranks.get(x.movie_id) ?? null })))
      })
      .catch((e) => {
        if (!alive) return
        // La table peut manquer si le schéma n'a pas été migré : les séries marchent sans.
        if (store.isMissingSchema(e)) setMoviesReady(false)
        else showNotice(failure('Chargement des films impossible', e))
        setMoviesLoading(false)
      })
    return () => {
      alive = false
    }
  }, [userId, showNotice])

  /** Remplace un film par `patch` appliqué à sa version courante. */
  const patchMovie = useCallback((movieId: number, patch: Partial<WatchedMovie>) => {
    setMovies((prev) => prev.map((m) => (m.movie_id === movieId ? { ...m, ...patch } : m)))
  }, [])

  /**
   * Mise à jour optimiste d'un film : affichée tout de suite, écrite ensuite,
   * et en cas d'échec seuls les champs touchés reprennent leur valeur d'avant.
   */
  const updateMovie = useCallback(
    async <K extends keyof WatchedMovie>(
      movieId: number,
      patch: Pick<WatchedMovie, K>,
      persist: () => Promise<unknown>,
      errorMessage: string | ((e: unknown) => string) | null,
    ): Promise<boolean> => {
      const before = findMovie(movieId)
      patchMovie(movieId, patch)
      try {
        await persist()
        return true
      } catch (e) {
        if (before) {
          const restore = {} as Partial<WatchedMovie>
          for (const k of Object.keys(patch) as K[]) restore[k] = before[k]
          patchMovie(movieId, restore)
        }
        if (errorMessage) showNotice(typeof errorMessage === 'string' ? failure(errorMessage, e) : errorMessage(e))
        return false
      }
    },
    [findMovie, patchMovie, showNotice],
  )

  const reorderMovies = useCallback(
    async (orderedIds: number[]) => {
      if (!movieRanksReady) {
        showNotice('Rangement indisponible : relance supabase/schema.sql dans ton projet Supabase.')
        return
      }
      const byId = new Map(moviesRef.current.map((m) => [m.movie_id, m]))
      const ordered = orderedIds.map((id) => byId.get(id)).filter((m): m is WatchedMovie => !!m)
      const changes = store.rerank(ordered, (m) => m.movie_id, (m) => m.wish_rank)
      if (!changes.length) return
      const apply = (rankOf: Map<string | number, number | null | undefined>) =>
        setMovies((prev) => prev.map((m) => (rankOf.has(m.movie_id) ? { ...m, wish_rank: rankOf.get(m.movie_id) } : m)))
      apply(new Map(changes.map((c) => [c.id, c.rank])))
      try {
        await store.saveRanks('watched_movies', changes)
      } catch (e) {
        // Seuls les rangs touchés reviennent en arrière : le reste a pu bouger entre-temps.
        apply(new Map(changes.map((c) => [c.id, byId.get(Number(c.id))?.wish_rank])))
        showNotice(failure('Rangement impossible', e))
      }
    },
    [movieRanksReady, showNotice, moviesRef],
  )

  const setMovieWith = useCallback(
    (movieId: number, ids: string[]) =>
      updateMovie(movieId, { watched_with: ids }, () => store.setMovieWith(movieId, ids), 'Enregistrement impossible').then(() => {}),
    [updateMovie],
  )

  const addMovies = useCallback(
    async (items: { movie: Movie; watchedAt: string | null }[]) => {
      if (!items.length) return
      if (!moviesReady) {
        showNotice(MISSING_TABLE)
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
        const movies = moviesRef.current
        const seenBefore = movies.filter((m) => m.status === 'watched').length
        checkMilestone('movie', seenBefore, seenBefore + items.filter((i) => !movies.some((m) => m.movie_id === i.movie.id)).length)
        if (items.length === 1) {
          nightOwl('movie')
          if (items[0].watchedAt) celebrate(movieCheer(items[0].movie.title))
        }
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
              rating: null,
            })
          }
          // Les films sans date passent en fin de liste.
          return [...byId.values()].sort((a, b) => (b.watched_at ?? '').localeCompare(a.watched_at ?? ''))
        })
      } catch (e) {
        showNotice(failure('Enregistrement du film impossible', e))
      }
    },
    [moviesReady, userId, moviesRef, showNotice],
  )

  const fillMovieRuntimes = useCallback(
    async (onProgress?: (done: number, total: number) => void) => {
      const missing = moviesRef.current.filter((m) => m.runtime == null)
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
        showNotice(failure('Mise à jour des durées impossible', e))
      }
    },
    [moviesRef, showNotice],
  )

  /**
   * Complète l'affiche et/ou la durée d'un film directement depuis sa fiche
   * détail, quand l'un des deux manque encore (film ajouté sans passer par
   * l'app) — silencieux en cas d'échec, ce n'est qu'un complément.
   */
  const fillMovieMeta = useCallback(
    async (movieId: number, patch: { poster_url?: string; runtime?: number; release_date?: string }) => {
      if (!Object.keys(patch).length) return
      patchMovie(movieId, patch)
      try {
        await store.fillMovieMeta(movieId, patch)
      } catch {
        /* un complément manqué n'est pas grave, on retentera à la prochaine visite */
      }
    },
    [patchMovie],
  )

  const rateMovie = useCallback(
    (movieId: number, rating: Rating | null) =>
      updateMovie(movieId, { rating }, () => store.rateMovie(movieId, rating), 'Note impossible à enregistrer').then(() => {}),
    [updateMovie],
  )

  const addToWatchlist = useCallback(
    async (movie: Movie) => {
      if (!moviesReady) {
        showNotice(MISSING_TABLE)
        return
      }
      if (findMovie(movie.id)) return
      const row: WatchedMovie = {
        movie_id: movie.id,
        title: movie.title,
        poster_url: movie.poster_url,
        release_year: movie.year,
        release_date: movie.release_date,
        watched_at: null,
        runtime: null,
        status: 'later',
        rating: null,
      }
      setMovies((prev) => [row, ...prev])
      try {
        await store.addToWatchlist(userId, movie)
      } catch (e) {
        setMovies((prev) => prev.filter((m) => m.movie_id !== movie.id))
        showNotice(failure('Ajout à voir impossible', e))
      }
    },
    [moviesReady, findMovie, userId, showNotice],
  )

  const markMovieWatched = useCallback(
    async (movieId: number, watchedAt: string | null) => {
      const before = findMovie(movieId)
      const ok = await updateMovie(
        movieId,
        { status: 'watched', watched_at: watchedAt },
        () => store.markMovieWatched(movieId, watchedAt),
        'Enregistrement impossible',
      )
      if (ok && before?.status !== 'watched') {
        const n = moviesRef.current.filter((m) => m.status === 'watched' && m.movie_id !== movieId).length
        checkMilestone('movie', n, n + 1)
        nightOwl('movie')
        if (before) celebrate(movieCheer(before.title))
      }
    },
    [findMovie, updateMovie, moviesRef],
  )

  // Écrit l'ensemble des visionnages d'un film d'un coup (le plus récent + ceux d'avant).
  const setMovieViews = useCallback(
    async (movieId: number, watchedAt: string | null, past: (string | null)[]) => {
      if (!findMovie(movieId)) return
      await updateMovie(
        movieId,
        { status: 'watched', watched_at: watchedAt, past_views: past },
        () => store.setMovieViews(movieId, watchedAt, past),
        (e) =>
          store.isMissingSchema(e)
            ? 'Revoir un film : relance supabase/schema.sql dans ton projet Supabase.'
            : failure('Enregistrement impossible', e),
      )
    },
    [findMovie, updateMovie],
  )

  const rewatchMovie = useCallback(
    async (movieId: number, at: string) => {
      const m = findMovie(movieId)
      if (!m) return
      await setMovieViews(movieId, at, [...(m.past_views ?? []), m.watched_at])
      celebrate(`🔁 ${m.title} : revu ! Toujours aussi bien ?`)
    },
    [findMovie, setMovieViews],
  )

  const removePastView = useCallback(
    async (movieId: number, index: number) => {
      const m = findMovie(movieId)
      if (!m) return
      await setMovieViews(movieId, m.watched_at, (m.past_views ?? []).filter((_, i) => i !== index))
    },
    [findMovie, setMovieViews],
  )

  const markMovieUnwatched = useCallback(
    async (movieId: number) => {
      // Revu par erreur : on retire seulement ce dernier visionnage, les précédents restent.
      const past = findMovie(movieId)?.past_views ?? []
      if (past.length) return setMovieViews(movieId, past[past.length - 1], past.slice(0, -1))
      await updateMovie(movieId, { status: 'later', watched_at: null }, () => store.markMovieUnwatched(movieId), 'Enregistrement impossible')
    },
    [findMovie, setMovieViews, updateMovie],
  )

  const removeMovie = useCallback(
    async (movieId: number) => {
      const before = findMovie(movieId)
      const index = moviesRef.current.findIndex((m) => m.movie_id === movieId)
      setMovies((prev) => prev.filter((m) => m.movie_id !== movieId))
      try {
        await store.removeMovie(movieId)
      } catch (e) {
        // Remet ce film seul, à sa place : le reste de la liste a pu changer entre-temps.
        if (before) setMovies((prev) => (prev.some((m) => m.movie_id === movieId) ? prev : [...prev.slice(0, index), before, ...prev.slice(index)]))
        showNotice(failure('Suppression impossible', e))
      }
    },
    [findMovie, moviesRef, showNotice],
  )

  const restoreMovie = useCallback(
    async (movie: WatchedMovie) => {
      setMovies((prev) => (prev.some((m) => m.movie_id === movie.movie_id) ? prev : [movie, ...prev]))
      try {
        await store.restoreMovie(userId, movie)
      } catch (e) {
        setMovies((prev) => prev.filter((m) => m.movie_id !== movie.movie_id))
        showNotice(failure('Annulation impossible', e))
      }
    },
    [userId, showNotice],
  )

  const value = useMemo<MoviesState>(
    () => ({
      movies, moviesReady, moviesLoading, movieRanksReady,
      addMovies, addToWatchlist, markMovieWatched, markMovieUnwatched, rewatchMovie, setMovieViews, removePastView,
      setMovieWith, removeMovie, restoreMovie, reorderMovies, fillMovieRuntimes, fillMovieMeta, rateMovie,
    }),
    [movies, moviesReady, moviesLoading, movieRanksReady,
     addMovies, addToWatchlist, markMovieWatched, markMovieUnwatched, rewatchMovie, setMovieViews, removePastView,
     setMovieWith, removeMovie, restoreMovie, reorderMovies, fillMovieRuntimes, fillMovieMeta, rateMovie],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Films vus ou à voir, et leurs actions. */
export function useMovies(): MoviesState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useMovies doit être utilisé dans <MoviesProvider>')
  return ctx
}
