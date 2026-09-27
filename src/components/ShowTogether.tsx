import { useState } from 'react'
import { notify } from '../lib/notify'
import { nameOf, type Profile } from '../lib/social'
import { useSocial } from '../lib/socialState'
import { supabase } from '../lib/supabase'
import { ActionButton } from './ActionBar'
import { Sheet, Switch } from './Sheet'
import type { TvEpisode } from '../lib/tvmaze'

type Scope = 'all' | 'pick' | number

/**
 * « 👫 À deux » sur une série : un seul bouton pour tout ce qui se regarde
 * avec un ami. Le panneau propose, pour l'ami choisi :
 *   — cocher aussi la suite chez lui (un interrupteur : chaque épisode coché
 *     ou décoché par l'un l'est chez l'autre) ;
 *   — cocher chez lui ce que vous avez déjà vu ensemble (toute la série, une
 *     saison ou des épisodes), à mes dates.
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
  const { socialReady, profile, friends, duos, duoFor, profileOf, linkDuo, stopDuo } = useSocial()
  const [open, setOpen] = useState(false)
  const [friendId, setFriendId] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>('all')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!socialReady || !profile || !friends.length) return null
  const link = duos ? duoFor(show.id) : undefined
  const linkedWith = link ? profileOf(link.partnerId) : undefined

  if (!open) {
    return (
      <ActionButton
        icon="👫"
        label={linkedWith ? `Avec ${nameOf(linkedWith)}` : 'À deux'}
        active={!!link}
        onClick={() => setOpen(true)}
      />
    )
  }

  // Un seul ami : inutile de le choisir. Une série déjà liée : l'ami est celui-là.
  const friend: Profile | undefined =
    friends.find((f) => f.user_id === (friendId ?? link?.partnerId)) ?? (friends.length === 1 ? friends[0] : undefined)

  const mine = episodes.filter((e) => watched.has(e.id))
  const seasons = [...new Set(mine.map((e) => e.season))].sort((a, b) => a - b)
  const chosen = mine.filter((e) => (scope === 'all' ? true : scope === 'pick' ? picked.has(e.id) : e.season === scope))
  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function sendPast(f: Profile) {
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('share_show_episodes', {
      p_friend: f.user_id,
      p_show_id: show.id,
      p_name: show.name,
      p_image: show.image,
      p_episodes: chosen.map((e) => ({ episode_id: e.id, season: e.season, number: e.number, watched_at: watched.get(e.id) ?? null })),
    })
    setBusy(false)
    if (err) return setError(err.message)
    const n = Number(data ?? 0)
    if (n > 0) notify({ event: 'show_together', to: f.user_id, showId: show.id })
    setDone(
      n > 0
        ? `${n} épisode${n > 1 ? 's' : ''} coché${n > 1 ? 's' : ''} chez ${nameOf(f)}.`
        : `${nameOf(f)} avait déjà tous ces épisodes.`,
    )
  }

  const linkedToOther = !!(link && friend && link.partnerId !== friend.user_id)
  const close = () => {
    setOpen(false)
    setDone(null)
    setError(null)
  }

  return (
    <>
      <ActionButton
        icon="👫"
        label={linkedWith ? `Avec ${nameOf(linkedWith)}` : 'À deux'}
        active={!!link}
        onClick={() => setOpen(true)}
      />
      <Sheet title={`${show.name}, à deux`} onClose={close}>
        {friends.length > 1 && (
          <section className="sheet__section">
            <p className="sheet__label">Avec</p>
            <div className="chips">
              {friends.map((f) => (
                <button
                  key={f.user_id}
                  className={`pill${friend?.user_id === f.user_id ? ' pill--on' : ''}`}
                  onClick={() => {
                    setFriendId(f.user_id)
                    setDone(null)
                  }}
                >
                  {nameOf(f)}
                </button>
              ))}
            </div>
          </section>
        )}

        {!friend && <p className="muted">Choisis avec qui tu la regardes.</p>}

        {friend && (
          <section className="sheet__section">
            <p className="sheet__label">La suite</p>
            <Switch
              checked={link?.partnerId === friend.user_id}
              disabled={linkedToOther}
              onChange={(on) => {
                if (on) void linkDuo(show, friend)
                else if (link) void stopDuo(link)
              }}
              label={`Cocher aussi pour ${nameOf(friend)}`}
              hint={
                linkedToOther
                  ? `Déjà liée avec ${linkedWith ? nameOf(linkedWith) : 'un autre ami'}.`
                  : 'Chaque épisode coché ou décoché par l’un l’est chez l’autre.'
              }
            />
          </section>
        )}

        {friend && mine.length > 0 && (
          <section className="sheet__section">
            <p className="sheet__label">Déjà vu ensemble</p>
            {done ? (
              <p className="together__done">✓ {done}</p>
            ) : (
              <>
                <div className="chips">
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
                <button className="btn btn--primary sheet__cta" disabled={busy || !chosen.length} onClick={() => sendPast(friend)}>
                  {busy ? 'Un instant…' : `Cocher ${chosen.length} épisode${chosen.length > 1 ? 's' : ''} chez ${nameOf(friend)}`}
                </button>
                <p className="muted together__note">À tes dates. Ce qu’il avait déjà vu garde sa date.</p>
              </>
            )}
          </section>
        )}
        {error && <p className="error">Impossible : {error}</p>}
      </Sheet>
    </>
  )
}
