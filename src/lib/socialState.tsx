import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as duo from './duo'
import type { Duo } from './duo'
import * as recs from './recs'
import type { Rec, RecKind, RecMeta } from './recs'
import { notify } from './notify'
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
  /** Séries à deux ; null si leurs tables manquent (schéma pas relancé). */
  duos: Duo[] | null
  duoFor: (showId: number) => Duo | undefined
  profileOf: (userId: string) => Profile | undefined
  /** Coche aussi pour cet ami chaque épisode de la série (et lui pour moi). */
  linkDuo: (show: { id: number; name: string; image: string | null }, partner: Profile) => Promise<void>
  stopDuo: (d: Duo) => Promise<void>
  /** Recommandations reçues, les plus récentes d'abord ; null si leur table manque. */
  incomingRecs: Rec[] | null
  sendRecs: (
    recipients: string[],
    item: { kind: RecKind; itemId: string; title: string; image: string | null; meta: RecMeta },
    note: string,
  ) => Promise<void>
  /** Retire une recommandation reçue (ajoutée à sa liste, ou « non merci »). */
  dismissRec: (r: Rec) => Promise<void>
}

const Ctx = createContext<SocialState | null>(null)

export function SocialProvider({
  onError,
  children,
}: {
  onError: (m: string) => void
  children: ReactNode
}) {
  const [socialReady, setReady] = useState(true)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [friendships, setFriendships] = useState<Friendship[]>([])
  const [duos, setDuos] = useState<Duo[] | null>(null)
  const [allRecs, setRecs] = useState<Rec[] | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [p, f] = await Promise.all([social.fetchMyProfile(), social.fetchFriendships()])
      setProfile(p)
      setFriendships(f)
      setReady(true)
      setDuos(await duo.fetchDuos().catch(() => null))
      setRecs(await recs.fetchRecs().catch(() => null))
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

  const ask = useCallback(
    (other: Profile) =>
      run(async () => {
        await social.askFriend(other, friendships)
        notify({ event: 'friend_request', to: other.user_id })
      }, 'Demande impossible'),
    [run, friendships],
  )
  const accept = useCallback(
    (other: Profile) =>
      run(async () => {
        await social.acceptFriend(other.user_id)
        notify({ event: 'friend_accept', to: other.user_id })
      }, 'Acceptation impossible'),
    [run],
  )
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

  const linkDuo = useCallback(
    (show: { id: number; name: string; image: string | null }, partner: Profile) =>
      run(async () => {
        await duo.linkDuo(show, partner)
        notify({ event: 'duo', to: partner.user_id, showId: show.id })
      }, 'Impossible'),
    [run],
  )
  const stopDuo = useCallback((d: Duo) => run(() => duo.stopDuo(d.show_id, d.partnerId), 'Arrêt impossible'), [run])
  const sendRecs = useCallback(
    (
      recipients: string[],
      item: { kind: RecKind; itemId: string; title: string; image: string | null; meta: RecMeta },
      note: string,
    ) =>
      run(async () => {
        await recs.sendRecs(recipients, item, note)
        for (const to of recipients) notify({ event: 'rec', to, kind: item.kind, itemId: item.itemId })
      }, 'Recommandation impossible'),
    [run],
  )
  const dismissRec = useCallback(
    async (r: Rec) => {
      setRecs((prev) => (prev ? prev.filter((x) => x.id !== r.id) : prev))
      try {
        await recs.removeRec(r.id)
      } catch (e) {
        onError(`Suppression impossible : ${(e as Error).message}`)
        refresh()
      }
    },
    [onError, refresh],
  )

  const duoFor = useCallback((showId: number) => duos?.find((d) => d.show_id === showId), [duos])
  const profileOf = useCallback(
    (userId: string) => friendships.find((f) => f.other.user_id === userId)?.other,
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
      duos,
      duoFor,
      profileOf,
      linkDuo,
      stopDuo,
      incomingRecs: allRecs && profile ? allRecs.filter((r) => r.recipient === profile.user_id) : allRecs && [],
      sendRecs,
      dismissRec,
    }),
    [socialReady, loading, profile, friendships, refresh, ask, accept, remove, relationWith, duos, duoFor, profileOf, linkDuo, stopDuo, allRecs, sendRecs, dismissRec],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSocial(): SocialState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSocial doit être utilisé dans <SocialProvider>')
  return ctx
}
