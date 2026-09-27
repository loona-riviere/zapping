import { useState } from 'react'
import { notify } from '../lib/notify'
import { nameOf } from '../lib/social'
import { useSocial } from '../lib/socialState'
import { supabase } from '../lib/supabase'
import type { TvEpisode } from '../lib/tvmaze'

type Scope = 'all' | 'pick' | number

/**
 * « 👫 Vu ensemble » sur une série : coche chez un ami des épisodes que tu as
 * vus, à tes dates — toute la série, une saison ou quelques épisodes. Sans
 * invitation : c'est du déjà-vu, pas une série à suivre à deux.
 */
export function ShowTogether({
  show,
  episodes,
  watched,
}: {
  show: { id: number; name: string; image: string | null }
  episodes: TvEpisode[]
  /** Épisodes cochés chez moi (visionnage en cours ou historique) et leur date. */
  watched: ReadonlyMap<number, string | null>
}) {
  const { socialReady, profile, friends } = useSocial()
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<Scope>('all')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mine = episodes.filter((e) => watched.has(e.id))
  if (!socialReady || !profile || !friends.length || !mine.length) return null
  if (done) return <p className="muted rec__sent">{done}</p>
  if (!open) {
    return (
      <button type="button" className="pill" onClick={() => setOpen(true)}>
        👫 Vu ensemble
      </button>
    )
  }

  const seasons = [...new Set(mine.map((e) => e.season))].sort((a, b) => a - b)
  const chosen = mine.filter((e) => (scope === 'all' ? true : scope === 'pick' ? picked.has(e.id) : e.season === scope))
  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function send(friendId: string, friendName: string) {
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('share_show_episodes', {
      p_friend: friendId,
      p_show_id: show.id,
      p_name: show.name,
      p_image: show.image,
      p_episodes: chosen.map((e) => ({ episode_id: e.id, season: e.season, number: e.number, watched_at: watched.get(e.id) ?? null })),
    })
    setBusy(false)
    if (err) return setError(err.message)
    const n = Number(data ?? 0)
    if (n > 0) notify({ event: 'show_together', to: friendId, showId: show.id })
    setDone(
      n > 0
        ? `👫 ${n} épisode${n > 1 ? 's' : ''} coché${n > 1 ? 's' : ''} chez ${friendName}.`
        : `👫 ${friendName} avait déjà tous ces épisodes.`,
    )
  }

  return (
    <div className="duo">
      <p>Qu'avez-vous vu ensemble ?</p>
      <div className="duo__friends">
        <button className={`pill${scope === 'all' ? ' pill--on' : ''}`} onClick={() => setScope('all')}>
          Toute la série
        </button>
        {seasons.length > 1 &&
          seasons.map((s) => (
            <button key={s} className={`pill${scope === s ? ' pill--on' : ''}`} onClick={() => setScope(s)}>
              Saison {s}
            </button>
          ))}
        <button className={`pill${scope === 'pick' ? ' pill--on' : ''}`} onClick={() => setScope('pick')}>
          Des épisodes
        </button>
      </div>
      {scope === 'pick' &&
        seasons.map((s) => (
          <div key={s} className="together__season">
            <span className="muted">S{s}</span>
            {mine
              .filter((e) => e.season === s)
              .map((e) => (
                <button
                  key={e.id}
                  className={`together__ep${picked.has(e.id) ? ' together__ep--on' : ''}`}
                  onClick={() => toggle(e.id)}
                  aria-pressed={picked.has(e.id)}
                  title={e.name}
                >
                  {e.number}
                </button>
              ))}
          </div>
        ))}
      <p className="muted" style={{ fontSize: '.85rem' }}>
        {chosen.length} épisode{chosen.length > 1 ? 's' : ''}, cochés chez l'autre à tes dates. Avec…
      </p>
      <div className="duo__friends">
        {friends.map((f) => (
          <button key={f.user_id} className="btn btn--primary" disabled={busy || !chosen.length} onClick={() => send(f.user_id, nameOf(f))}>
            {nameOf(f)}
          </button>
        ))}
        <button className="link-btn muted" onClick={() => setOpen(false)}>Annuler</button>
      </div>
      {error && <p className="error">Impossible : {error}</p>}
    </div>
  )
}
