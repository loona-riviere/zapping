import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as store from './store'
import type { Rating, ShowStatus, TrackedShow, Viewing, WatchedMap } from './store'
import { celebrate, checkMilestone, nightOwl } from './fun'
import { computeProgress } from './progress'
import { getShowWithEpisodes } from './tvmaze'
import { syncDuo } from './duo'
import { failure, useShowNotice } from './notice'
import { useLatest } from './useLatest'
import type { TvEpisode, TvShow } from './tvmaze'

/**
 * Épisodes vus d'une série : identifiant → date de visionnage (ISO), ou null
 * quand elle est inconnue. La présence de la clé signifie « vu » ; sa valeur
 * ne dit que le quand.
 */
export type WatchedEpisodes = ReadonlyMap<number, string | null>

export type ShowsState = {
  tracked: TrackedShow[]
  watched: WatchedMap
  loading: boolean
  isTracked: (showId: number) => boolean
  statusOf: (showId: number) => ShowStatus
  watchedFor: (showId: number) => WatchedEpisodes
  track: (show: TvShow) => Promise<void>
  untrack: (showId: number) => Promise<void>
  setStatus: (showId: number, status: ShowStatus) => Promise<void>
  /** Nombre de revisionnages complets d'une série, en plus du premier. */
  rewatchesOf: (showId: number) => number
  /** Revisionnages terminés datés, et leur nombre total (datés ou non). */
  setShowViewings: (showId: number, past: Viewing[], rewatches: number) => Promise<void>
  /** Amis présents au premier visionnage d'une série. */
  setShowFirstWith: (showId: number, ids: string[]) => Promise<void>
  setRewatches: (showId: number, count: number) => Promise<void>
  /** Un revisionnage est-il en cours sur cette série ? */
  isRewatching: (showId: number) => boolean
  /** Progression historique, indépendante du revisionnage en cours. */
  historyFor: (showId: number) => WatchedEpisodes
  startRewatch: (showId: number) => Promise<void>
  /** `completed` incrémente le compteur ; sinon le revisionnage est abandonné. */
  endRewatch: (showId: number, completed: boolean, withIds?: string[]) => Promise<void>
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
  /** Faux tant que `supabase/schema.sql` n'a pas été relancé : pas de colonne wish_rank. */
  ranksReady: boolean
  /** Range « à regarder plus tard » dans l'ordre d'envie donné (identifiants). */
  reorderShows: (orderedIds: number[]) => Promise<void>
  /** Relit séries et épisodes vus (ce qu'un partenaire a coché sur une série à deux). */
  reloadShows: () => Promise<void>
  /** Recale `last_watched_at` sur la vraie date, quand le diagnostic en trouve un décalage. */
  fixActivity: (showId: number, actual: string | null) => Promise<void>
  /** Pose le titre français d'une série une fois trouvé chez TMDB. */
  renameShow: (showId: number, name: string) => Promise<void>
  rateShow: (showId: number, rating: Rating | null) => Promise<void>
}

const Ctx = createContext<ShowsState | null>(null)
const EMPTY: WatchedEpisodes = new Map()

/** Date la plus récente d'une liste, ou null. */
const latest = (dates: Iterable<string | null>) => {
  let max: string | null = null
  for (const d of dates) if (d && (!max || d > max)) max = d
  return max
}

export function ShowsProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const showNotice = useShowNotice()
  const [tracked, setTracked] = useState<TrackedShow[]>([])
  const [watched, setWatchedMap] = useState<WatchedMap>(new Map())
  const [rewatch, setRewatch] = useState<WatchedMap>(new Map())
  const [loading, setLoading] = useState(true)
  const [ranksReady, setRanksReady] = useState(true)
  const trackedRef = useLatest(tracked)
  const watchedRef = useLatest(watched)
  const rewatchRef = useLatest(rewatch)
  const findShow = useCallback((id: number) => trackedRef.current.find((t) => t.show_id === id), [trackedRef])

  useEffect(() => {
    let alive = true
    Promise.all([store.fetchTracked(), store.fetchWatched(), store.fetchRewatchProgress()])
      .then(async ([t, w, r]) => {
        if (!alive) return
        setTracked(t)
        setWatchedMap(w)
        setRewatch(r)
        setLoading(false)
        // Rangs d'envie, lus à part une fois la liste là : la colonne peut
        // manquer sans empêcher le reste de se charger.
        const ranks = await store.fetchRanks('tracked_shows').catch(() => undefined)
        if (!alive || ranks === undefined) return // indisponible pour cette fois
        if (!ranks) setRanksReady(false)
        else setTracked((prev) => prev.map((x) => ({ ...x, wish_rank: ranks.get(x.show_id) ?? null })))
      })
      .catch((e) => {
        if (!alive) return
        showNotice(failure('Chargement impossible', e))
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [userId, showNotice])

  const patchShow = useCallback((showId: number, patch: Partial<TrackedShow>) => {
    setTracked((prev) => prev.map((t) => (t.show_id === showId ? { ...t, ...patch } : t)))
  }, [])

  const reorderShows = useCallback(
    async (orderedIds: number[]) => {
      if (!ranksReady) {
        showNotice('Rangement indisponible : relance supabase/schema.sql dans ton projet Supabase.')
        return
      }
      const byId = new Map(trackedRef.current.map((t) => [t.show_id, t]))
      const ordered = orderedIds.map((id) => byId.get(id)).filter((t): t is TrackedShow => !!t)
      const changes = store.rerank(ordered, (t) => t.show_id, (t) => t.wish_rank)
      if (!changes.length) return
      const apply = (rankOf: Map<string | number, number | null | undefined>) =>
        setTracked((prev) => prev.map((t) => (rankOf.has(t.show_id) ? { ...t, wish_rank: rankOf.get(t.show_id) } : t)))
      apply(new Map(changes.map((c) => [c.id, c.rank])))
      try {
        await store.saveRanks('tracked_shows', changes)
      } catch (e) {
        // Seuls les rangs touchés reviennent en arrière : le reste a pu bouger entre-temps.
        apply(new Map(changes.map((c) => [c.id, byId.get(Number(c.id))?.wish_rank])))
        showNotice(failure('Rangement impossible', e))
      }
    },
    [ranksReady, showNotice, trackedRef],
  )

  const reloadShows = useCallback(async () => {
    try {
      const [t, w, r, ranks] = await Promise.all([
        store.fetchTracked(),
        store.fetchWatched(),
        store.fetchRewatchProgress(),
        store.fetchRanks('tracked_shows').catch(() => null),
      ])
      setTracked(ranks ? t.map((x) => ({ ...x, wish_rank: ranks.get(x.show_id) ?? null })) : t)
      setWatchedMap(w)
      setRewatch(r)
    } catch {
      /* hors ligne : on garde ce qu'on a */
    }
  }, [])

  // Retour dans l'app après un moment : ce qu'un partenaire a coché sur une
  // série à deux (ou soi-même sur un autre appareil) apparaît sans recharger.
  useEffect(() => {
    let last = Date.now()
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 60_000) return
      last = Date.now()
      reloadShows()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reloadShows])

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
  const rewatchesOf = useCallback(
    (id: number) => tracked.find((t) => t.show_id === id)?.rewatches ?? 0,
    [tracked],
  )

  const track = useCallback(
    async (show: TvShow) => {
      if (findShow(show.id)) return
      try {
        const row = await store.trackShow(userId, show)
        setTracked((prev) => (prev.some((t) => t.show_id === show.id) ? prev : [row, ...prev]))
      } catch (e) {
        showNotice(failure(`Impossible d'ajouter ${show.name}`, e))
      }
    },
    [findShow, userId, showNotice],
  )

  const untrack = useCallback(
    async (showId: number) => {
      try {
        await store.untrackShow(showId)
        setTracked((prev) => prev.filter((t) => t.show_id !== showId))
        setWatchedMap((prev) => {
          const next = new Map(prev)
          next.delete(showId)
          return next
        })
      } catch (e) {
        showNotice(failure('Suppression impossible', e))
      }
    },
    [showNotice],
  )

  /**
   * Mise à jour optimiste d'une série : le correctif s'affiche tout de suite,
   * l'écriture suit, et en cas d'échec seuls les champs touchés reprennent
   * leur valeur d'avant.
   */
  const updateShow = useCallback(
    async <K extends keyof TrackedShow>(
      showId: number,
      patch: Pick<TrackedShow, K>,
      persist: () => Promise<unknown>,
      errorMessage: string | ((e: unknown) => string) | null,
    ) => {
      const before = trackedRef.current.find((t) => t.show_id === showId)
      patchShow(showId, patch)
      try {
        await persist()
      } catch (e) {
        if (before) {
          const restore = {} as Partial<TrackedShow>
          for (const k of Object.keys(patch) as K[]) restore[k] = before[k]
          patchShow(showId, restore)
        }
        if (errorMessage) showNotice(typeof errorMessage === 'string' ? failure(errorMessage, e) : errorMessage(e))
      }
    },
    [patchShow, showNotice, trackedRef],
  )

  const setStatus = useCallback(
    (showId: number, status: ShowStatus) =>
      updateShow(showId, { status }, () => store.setShowStatus(showId, status), 'Changement de statut impossible'),
    [updateShow],
  )

  const setRewatches = useCallback(
    (showId: number, count: number) => {
      const rewatches = Math.max(0, Math.round(count))
      return updateShow(showId, { rewatches }, () => store.setRewatches(showId, rewatches), 'Enregistrement du revisionnage impossible')
    },
    [updateShow],
  )

  const setShowViewings = useCallback(
    async (showId: number, past: Viewing[], rewatches: number) => {
      if (!findShow(showId)) return
      await updateShow(showId, { past_viewings: past, rewatches }, () => store.setShowViewings(showId, past, rewatches), (e) =>
        store.isMissingSchema(e)
          ? 'Dates des revisionnages : relance supabase/schema.sql dans ton projet Supabase.'
          : failure('Enregistrement impossible', e),
      )
    },
    [findShow, updateShow],
  )

  const setShowFirstWith = useCallback(
    (showId: number, ids: string[]) =>
      updateShow(showId, { first_with: ids }, () => store.setShowFirstWith(showId, ids), 'Enregistrement impossible'),
    [updateShow],
  )

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
        showNotice(failure('Impossible de démarrer le revisionnage', e))
      }
    },
    [patchShow, showNotice],
  )

  const endRewatch = useCallback(
    async (showId: number, completed: boolean, withIds?: string[]) => {
      const before = findShow(showId)
      const next = (before?.rewatches ?? 0) + (completed ? 1 : 0)
      // Une passe terminée garde ses dates : du premier au dernier épisode recoché.
      const dates = [...(rewatchRef.current.get(showId)?.values() ?? [])].filter((d): d is string => !!d).sort()
      const past = completed
        ? [...(before?.past_viewings ?? []), { started_at: dates[0] ?? null, finished_at: dates[dates.length - 1] ?? null, ...(withIds?.length ? { with: withIds } : {}) }]
        : before?.past_viewings ?? []
      patchShow(showId, { rewatching: false, rewatches: next, past_viewings: past })
      setRewatch((prev) => {
        const m = new Map(prev)
        m.delete(showId)
        return m
      })
      try {
        if (completed) {
          await store.setShowViewings(showId, past, next).catch((e) => {
            // Colonne des dates absente : on garde au moins le compte.
            if (!store.isMissingSchema(e)) throw e
            return store.setRewatches(showId, next)
          })
        }
        await store.setRewatching(showId, false)
        await store.clearRewatchProgress(showId)
      } catch (e) {
        if (before) patchShow(showId, { rewatching: true, rewatches: before.rewatches, past_viewings: before.past_viewings })
        showNotice(failure('Impossible de clore le revisionnage', e))
      }
    },
    [findShow, patchShow, showNotice, rewatchRef],
  )

  /** Après avoir coché des épisodes : palier franchi, série bouclée, coche nocturne. */
  const cheerEpisodes = useCallback(
    (show: TvShow, ids: number[]) => {
      const watched = watchedRef.current
      const before = [...watched.values()].reduce((n, eps) => n + eps.size, 0)
      const already = watched.get(show.id) ?? new Map()
      const added = ids.filter((id) => !already.has(id)).length
      checkMilestone('episode', before, before + added)
      nightOwl('show')
      // Fiche en cache (12 h) : pas de requête de plus en général.
      getShowWithEpisodes(show.id)
        .then((data) => {
          if (data.show.status !== 'Ended') return
          const seen = new Map(already)
          ids.forEach((id) => seen.set(id, null))
          const was = computeProgress(data.episodes, already)
          const now = computeProgress(data.episodes, seen)
          // C'est ce clic-là qui boucle la série : avant il manquait des épisodes, plus maintenant.
          if (now.aired > 0 && now.watched === now.aired && was.watched < was.aired) {
            celebrate(`🎬 ${trackedRef.current.find((t) => t.show_id === show.id)?.name ?? show.name} : série terminée ! Générique.`)
          }
        })
        .catch(() => {
          /* pas de fiche : pas de fête, rien de grave */
        })
    },
    [watchedRef, trackedRef],
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
      const current = findShow(show.id)

      // Pendant un revisionnage, on coche dans la passe en cours : l'historique
      // reste intact, et décocher ne perd rien du premier visionnage.
      //
      // Un import est l'exception : il apporte du passé, pas la passe du soir.
      // Sans ce garde-fou, importer pendant un revisionnage y déverserait la
      // série entière et la clorait d'un coup.
      if (current?.rewatching && !toHistory) {
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
        const currentPass = new Map(rewatchRef.current.get(show.id) ?? [])
        ids.forEach((id) => {
          if (!value) { currentPass.delete(id); return }
          currentPass.set(id, dates ? (dates.get(id) ?? null) : now)
        })
        // Plus rien de daté dans cette passe : on retombe sur le dernier
        // visionnage historique, pas sur « aucune activité ».
        const last = latest(currentPass.values()) ?? latest(watchedRef.current.get(show.id)?.values() ?? [])
        patchShow(show.id, { last_watched_at: last })
        try {
          if (value) await store.markRewatched(userId, show.id, eps, dates, overwrite)
          else await store.unmarkRewatched(ids)
          await store.touchLastWatched(show.id, last)
          // Revisionnage à deux : même coche chez l'autre.
          void syncDuo(show.id, eps, value, dates)
        } catch (e) {
          applyRewatch(!value)
          showNotice(failure('Enregistrement impossible', e))
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
      let uncheckedLastWatched: string | null = null
      if (value) {
        // Une reprise sans date ne remonte pas la série en tête de liste.
        const last = latest(ids.map((id) => (dates ? dates.get(id) ?? null : now)))
        if (last) patchShow(show.id, { last_watched_at: last })
      } else {
        // Décocher ce qui était en fait la date la plus récente doit faire
        // retomber la série à sa vraie dernière activité, pas la laisser
        // en tête sur une date qui ne correspond plus à rien de coché.
        const remaining = [...(watchedRef.current.get(show.id) ?? new Map<number, string | null>())]
        uncheckedLastWatched = latest(remaining.filter(([epId]) => !ids.includes(epId)).map(([, d]) => d))
        patchShow(show.id, { last_watched_at: uncheckedLastWatched })
      }
      // Un premier épisode coché sort la série de « à voir » : elle est
      // maintenant commencée, pas juste projetée.
      const wasNotStarted = current?.status === 'later'
      if (value && wasNotStarted) patchShow(show.id, { status: 'watching' })
      try {
        if (value) {
          if (!current) await track(show)
          if (wasNotStarted) await store.setShowStatus(show.id, 'watching')
          await store.markWatched(userId, show.id, eps, dates, overwrite)
          // Un clic dans l'app (pas un import daté) : paliers, fin de série, heure tardive.
          if (!dates) cheerEpisodes(show, ids)
        } else {
          await store.markUnwatched(ids)
          await store.touchLastWatched(show.id, uncheckedLastWatched)
        }
        // Série regardée à deux : même coche chez l'autre.
        void syncDuo(show.id, eps, value, dates)
      } catch (e) {
        apply(!value)
        if (wasNotStarted) patchShow(show.id, { status: 'later' })
        showNotice(failure('Enregistrement impossible', e))
      }
    },
    [findShow, track, userId, cheerEpisodes, patchShow, showNotice, watchedRef, rewatchRef],
  )

  /** Pose le titre français une fois trouvé chez TMDB — silencieux en cas d'échec, on retentera à la prochaine visite. */
  const renameShow = useCallback(
    (showId: number, name: string) => updateShow(showId, { name }, () => store.renameShow(showId, name), null),
    [updateShow],
  )

  const rateShow = useCallback(
    (showId: number, rating: Rating | null) =>
      updateShow(showId, { rating }, () => store.rateShow(showId, rating), 'Note impossible à enregistrer'),
    [updateShow],
  )

  const fixActivity = useCallback(
    (showId: number, actual: string | null) =>
      updateShow(showId, { last_watched_at: actual }, () => store.touchLastWatched(showId, actual), 'Correction impossible'),
    [updateShow],
  )

  const value = useMemo<ShowsState>(
    () => ({
      tracked, watched, loading, ranksReady,
      isTracked, statusOf, watchedFor, historyFor, rewatchesOf, isRewatching,
      track, untrack, setStatus, setWatched, setRewatches, setShowViewings, setShowFirstWith,
      startRewatch, endRewatch, reorderShows, reloadShows, fixActivity, renameShow, rateShow,
    }),
    [tracked, watched, loading, ranksReady,
     isTracked, statusOf, watchedFor, historyFor, rewatchesOf, isRewatching,
     track, untrack, setStatus, setWatched, setRewatches, setShowViewings, setShowFirstWith,
     startRewatch, endRewatch, reorderShows, reloadShows, fixActivity, renameShow, rateShow],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Séries suivies, épisodes vus et leurs actions. */
export function useShows(): ShowsState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useShows doit être utilisé dans <ShowsProvider>')
  return ctx
}
