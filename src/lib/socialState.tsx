import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as social from './social'
import type { Friendship, Profile } from './social'
import { isMissingSchema } from './store'

type SocialState = {
  /** Faux tant que la partie « amis » de supabase/schema.sql n'a pas été passée. */
  socialReady: boolean
  loading: boolean
  profile: Profile | null
  friendships: Friendship[]
  friends: Profile[]
  /** Demandes reçues, en attente d'une réponse. */
  incoming: Friendship[]
  refresh: () => Promise<void>
  setProfile: (p: Profile) => void
  ask: (other: Profile) => Promise<void>
  accept: (other: Profile) => Promise<void>
  remove: (other: Profile) => Promise<void>
  relationWith: (userId: string) => 'none' | 'sent' | 'received' | 'friends'
}

const Ctx = createContext<SocialState | null>(null)

export function SocialProvider({ onError, children }: { onError: (m: string) => void; children: ReactNode }) {
  const [socialReady, setReady] = useState(true)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [friendships, setFriendships] = useState<Friendship[]>([])

  const refresh = useCallback(async () => {
    try {
      const [p, f] = await Promise.all([social.fetchMyProfile(), social.fetchFriendships()])
      setProfile(p)
      setFriendships(f)
      setReady(true)
    } catch (e) {
      if (isMissingSchema(e)) setReady(false)
      // Réseau : on garde ce qu'on avait, ce n'est pas le cœur de l'app.
    } finally {
      setLoading(false)
    }
  }, [])

  // Au lancement, puis à chaque retour dans l'app : une demande reçue
  // pendant qu'on était ailleurs apparaît sans avoir à recharger.
  useEffect(() => {
    refresh()
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const run = useCallback(
    async (action: () => Promise<void>, failure: string) => {
      try {
        await action()
      } catch (e) {
        onError(`${failure} : ${(e as Error).message}`)
      }
      await refresh()
    },
    [onError, refresh],
  )

  const ask = useCallback((other: Profile) => run(() => social.askFriend(other, friendships), 'Demande impossible'), [run, friendships])
  const accept = useCallback((other: Profile) => run(() => social.acceptFriend(other.user_id), 'Acceptation impossible'), [run])
  const remove = useCallback((other: Profile) => run(() => social.removeFriend(other.user_id), 'Suppression impossible'), [run])

  const relationWith = useCallback(
    (userId: string) => {
      const f = friendships.find((x) => x.other.user_id === userId)
      if (!f) return 'none' as const
      if (f.status === 'accepted') return 'friends' as const
      return f.sentByMe ? ('sent' as const) : ('received' as const)
    },
    [friendships],
  )

  const value = useMemo<SocialState>(
    () => ({
      socialReady,
      loading,
      profile,
      friendships,
      friends: friendships.filter((f) => f.status === 'accepted').map((f) => f.other),
      incoming: friendships.filter((f) => f.status === 'pending' && !f.sentByMe),
      refresh,
      setProfile,
      ask,
      accept,
      remove,
      relationWith,
    }),
    [socialReady, loading, profile, friendships, refresh, ask, accept, remove, relationWith],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSocial(): SocialState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSocial doit être utilisé dans <SocialProvider>')
  return ctx
}
