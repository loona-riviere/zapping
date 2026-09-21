import { useEffect, useState } from 'react'
import { getShowWithEpisodes, type ShowWithEpisodes } from './tvmaze'

/**
 * Charge les épisodes de toutes les séries suivies, quatre à la fois pour
 * ménager TVmaze (~20 requêtes / 10 s). Les fiches sont mises en cache 12 h
 * dans le navigateur, donc les visites suivantes ne coûtent rien.
 */
export function useShowEpisodes(ids: number[]) {
  const [data, setData] = useState<Record<number, ShowWithEpisodes>>({})
  const [failed, setFailed] = useState<Set<number>>(new Set())

  useEffect(() => {
    let alive = true
    const queue = ids.filter((id) => !data[id])
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        try {
          const d = await getShowWithEpisodes(id)
          if (alive) setData((c) => ({ ...c, [id]: d }))
        } catch {
          if (alive) setFailed((f) => new Set(f).add(id))
        }
      }
    }
    Promise.all([worker(), worker(), worker(), worker()])
    return () => {
      alive = false
    }
    // `data` est volontairement hors dépendances : il grossit à chaque réponse
    // et le relancer relancerait la file en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(',')])

  return { data, failed }
}
