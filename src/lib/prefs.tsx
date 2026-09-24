import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

/** Ce qu'on suit dans l'app : chaque type a son onglet, sa recherche et ses stats. */
export type Kind = 'show' | 'movie' | 'book'

export const KINDS: Kind[] = ['show', 'movie', 'book']

export const KIND_LABEL: Record<Kind, string> = { show: 'Séries', movie: 'Films', book: 'Livres' }

type Prefs = {
  /** Types suivis, dans l'ordre des onglets ; jamais vide. */
  kinds: Kind[]
  has: (k: Kind) => boolean
  setKind: (k: Kind, on: boolean) => Promise<void>
}

const Ctx = createContext<Prefs | null>(null)

function readKinds(user: User): Kind[] {
  const raw = user.user_metadata?.kinds
  if (!Array.isArray(raw)) return KINDS
  const kinds = KINDS.filter((k) => raw.includes(k))
  return kinds.length ? kinds : KINDS
}

/**
 * Les types suivis vivent dans les métadonnées du compte Supabase plutôt
 * que dans une table : ils suivent d'un appareil à l'autre sans rien
 * ajouter au schéma. Par défaut, les trois.
 */
export function PrefsProvider({ user, children }: { user: User; children: ReactNode }) {
  const [kinds, setKinds] = useState<Kind[]>(() => readKinds(user))

  const has = useCallback((k: Kind) => kinds.includes(k), [kinds])

  const setKind = useCallback(
    async (k: Kind, on: boolean) => {
      const next = KINDS.filter((x) => (x === k ? on : kinds.includes(x)))
      if (!next.length) return // au moins un type : une app vide n'a pas de sens
      const before = kinds
      setKinds(next)
      const { error } = await supabase.auth.updateUser({ data: { kinds: next } })
      if (error) setKinds(before)
    },
    [kinds],
  )

  const value = useMemo(() => ({ kinds, has, setKind }), [kinds, has, setKind])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePrefs(): Prefs {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePrefs doit être utilisé dans <PrefsProvider>')
  return ctx
}
