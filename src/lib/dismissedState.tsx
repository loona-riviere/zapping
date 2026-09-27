import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as store from './store'
import type { DismissedRec } from './store'
import { failure, useShowNotice } from './notice'
import { useLatest } from './useLatest'

type Kind = 'show' | 'movie'

export type DismissedState = {
  /** Suggestions écartées dans « Recommandé pour toi », consultables depuis les paramètres. */
  dismissed: DismissedRec[]
  isDismissed: (kind: Kind, id: number) => boolean
  dismissRec: (kind: Kind, id: number, name: string, posterUrl: string | null) => Promise<void>
  undismissRec: (kind: Kind, id: number) => Promise<void>
}

const Ctx = createContext<DismissedState | null>(null)
const same = (kind: Kind, id: number) => (d: DismissedRec) => d.kind === kind && d.tmdb_id === id

export function DismissedProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const showNotice = useShowNotice()
  const [dismissed, setDismissed] = useState<DismissedRec[]>([])
  const dismissedRef = useLatest(dismissed)

  useEffect(() => {
    let alive = true
    store
      .fetchDismissed()
      .then((d) => alive && setDismissed(d))
      .catch(() => {
        /* liste secondaire : pas grave si elle manque, on repart à zéro */
      })
    return () => {
      alive = false
    }
  }, [userId])

  const isDismissed = useCallback((kind: Kind, id: number) => dismissed.some(same(kind, id)), [dismissed])

  const dismissRec = useCallback(
    async (kind: Kind, id: number, name: string, posterUrl: string | null) => {
      setDismissed((prev) => [{ kind, tmdb_id: id, name, poster_url: posterUrl, dismissed_at: new Date().toISOString() }, ...prev])
      try {
        await store.dismissRec(kind, id, name, posterUrl)
      } catch (e) {
        // Retire seulement celle-ci : une autre a pu être écartée entre-temps.
        setDismissed((prev) => prev.filter((d) => !same(kind, id)(d)))
        showNotice(failure('Enregistrement impossible', e))
      }
    },
    [showNotice],
  )

  const undismissRec = useCallback(
    async (kind: Kind, id: number) => {
      const removed = dismissedRef.current.find(same(kind, id))
      setDismissed((prev) => prev.filter((d) => !same(kind, id)(d)))
      try {
        await store.undismissRec(kind, id)
      } catch (e) {
        if (removed) setDismissed((prev) => (prev.some(same(kind, id)) ? prev : [removed, ...prev]))
        showNotice(failure('Suppression impossible', e))
      }
    },
    [dismissedRef, showNotice],
  )

  const value = useMemo(() => ({ dismissed, isDismissed, dismissRec, undismissRec }), [dismissed, isDismissed, dismissRec, undismissRec])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDismissed(): DismissedState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDismissed doit être utilisé dans <DismissedProvider>')
  return ctx
}
