import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as store from './store'
import type { TrackedShow } from './store'
import type { TvEpisode, TvShow } from './tvmaze'

type AppState = {
  userId: string
  tracked: TrackedShow[]
  watched: Map<number, Set<number>>
  loading: boolean
  notice: string | null
  dismissNotice: () => void
  isTracked: (showId: number) => boolean
  watchedFor: (showId: number) => Set<number>
  track: (show: TvShow) => Promise<void>
  untrack: (showId: number) => Promise<void>
  setWatched: (show: TvShow, eps: TvEpisode[], value: boolean) => Promise<void>
}

const Ctx = createContext<AppState | null>(null)
const EMPTY = new Set<number>()

export function AppProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [tracked, setTracked] = useState<TrackedShow[]>([])
  const [watched, setWatchedMap] = useState<Map<number, Set<number>>>(new Map())
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([store.fetchTracked(), store.fetchWatched()])
      .then(([t, w]) => {
        if (!alive) return
        setTracked(t)
        setWatchedMap(w)
      })
      .catch((e) => alive && setNotice(`Chargement impossible : ${e.message}`))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [userId])

  const isTracked = useCallback((id: number) => tracked.some((t) => t.show_id === id), [tracked])
  const watchedFor = useCallback((id: number) => watched.get(id) ?? EMPTY, [watched])

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

  const setWatched = useCallback(
    async (show: TvShow, eps: TvEpisode[], value: boolean) => {
      if (!eps.length) return
      const ids = eps.map((e) => e.id)
      const apply = (on: boolean) =>
        setWatchedMap((prev) => {
          const next = new Map(prev)
          const set = new Set(prev.get(show.id) ?? [])
          ids.forEach((id) => (on ? set.add(id) : set.delete(id)))
          next.set(show.id, set)
          return next
        })

      apply(value) // mise à jour optimiste
      if (value) {
        setTracked((prev) =>
          prev.map((t) => (t.show_id === show.id ? { ...t, last_watched_at: new Date().toISOString() } : t)),
        )
      }
      try {
        if (value) {
          if (!tracked.some((t) => t.show_id === show.id)) await track(show)
          await store.markWatched(userId, show.id, eps)
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

  const value = useMemo<AppState>(
    () => ({
      userId, tracked, watched, loading, notice,
      dismissNotice: () => setNotice(null),
      isTracked, watchedFor, track, untrack, setWatched,
    }),
    [userId, tracked, watched, loading, notice, isTracked, watchedFor, track, untrack, setWatched],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp doit être utilisé dans <AppProvider>')
  return ctx
}
