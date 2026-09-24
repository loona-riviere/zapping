import { useEffect, useState } from 'react'
import { getShowWithEpisodes, isFresh, peekShows, type ShowWithEpisodes } from './tvmaze'

/**
 * Fiches et épisodes des séries demandées. D'abord tout ce qui est en cache,
 * même périmé, d'un seul coup (`ready`) : la bibliothèque s'affiche entière
 * au lieu de se remplir série par série. Ensuite, en arrière-plan, quatre à
 * la fois pour ménager TVmaze (~20 requêtes / 10 s) : les fiches jamais
 * chargées d'abord, puis le rafraîchissement des périmées (> 12 h).
 */
export function useShowEpisodes(ids: number[]) {
  const [data, setData] = useState<Record<number, ShowWithEpisodes>>({})
  const [failed, setFailed] = useState<Set<number>>(new Set())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const cached = await peekShows(ids)
      if (!alive) return
      setData((c) => {
        const next = { ...c }
        for (const [id, entry] of cached) next[id] = entry.data
        return next
      })
      setReady(true)

      const missing = ids.filter((id) => !cached.has(id))
      const stale = ids.filter((id) => {
        const c = cached.get(id)
        return c && !isFresh(c)
      })
      const queue = [...missing, ...stale]
      const worker = async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          try {
            const d = await getShowWithEpisodes(id)
            if (alive) setData((c) => ({ ...c, [id]: d }))
          } catch {
            // Une fiche périmée reste affichée : l'échec ne compte que sans rien en cache.
            if (alive && !cached.has(id)) setFailed((f) => new Set(f).add(id))
          }
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()])
    })()
    return () => {
      alive = false
    }
    // La liste d'identifiants suffit : relancer à chaque réponse bouclerait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(',')])

  return { data, failed, ready }
}
