import { useEffect, useState } from 'react'
import type { FriendOn } from '../lib/friendsOn'
import { href } from '../lib/route'
import { nameOf } from '../lib/social'
import { useSocial } from '../lib/socialState'
import { Sheet } from './Sheet'

const RATING_ICON = { love: '❤️', like: '👍', dislike: '👎' } as const
const ORDER: FriendOn['state'][] = ['done', 'doing', 'later', 'dropped']

/**
 * « Julien et Maman l'ont vue » sous les actions d'une fiche : les pastilles
 * des amis qui ont ce titre, et d'un appui le détail (où chacun en est, sa
 * note). Rien si aucun ami ne l'a.
 */
export function FriendsOn({
  load,
  noun,
}: {
  /** Récupère l'état des amis pour ce titre. */
  load: (friendIds: string[]) => Promise<FriendOn[]>
  /** Accord du participe : « vue » (série), « vu » (film), « lu » (livre). */
  noun: 'vue' | 'vu' | 'lu'
}) {
  const { friends, profileOf } = useSocial()
  const [rows, setRows] = useState<FriendOn[] | null>(null)
  const [open, setOpen] = useState(false)
  const ids = friends.map((f) => f.user_id).join(',')

  useEffect(() => {
    let alive = true
    load(friends.map((f) => f.user_id))
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids])

  if (!rows?.length) return null
  const sorted = [...rows].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state))
  const names = (list: FriendOn[]) => list.map((r) => { const p = profileOf(r.userId); return p ? nameOf(p) : 'un ami' })
  const done = sorted.filter((r) => r.state === 'done')
  const doing = sorted.filter((r) => r.state === 'doing')
  const join = (n: string[]) => (n.length <= 2 ? n.join(' et ') : `${n.slice(0, 2).join(', ')} et ${n.length - 2} autre${n.length > 3 ? 's' : ''}`)
  const line = done.length
    ? `${join(names(done))} l${done.length > 1 ? "'ont" : "'a"} ${noun}${noun === 'vue' ? '' : ''}${doing.length ? ` · ${doing.length} en cours` : ''}`
    : doing.length
      ? `${join(names(doing))} ${doing.length > 1 ? 'sont' : 'est'} dessus`
      : `${join(names(sorted))} l${sorted.length > 1 ? "'ont" : "'a"} dans sa liste`

  return (
    <>
      <button type="button" className="friends-on" onClick={() => setOpen(true)}>
        <span className="friends-on__faces" aria-hidden="true">
          {sorted.slice(0, 4).map((r) => {
            const p = profileOf(r.userId)
            return (
              <span key={r.userId} className="avatar friends-on__face">
                {(p ? nameOf(p) : '?').slice(0, 1).toUpperCase()}
              </span>
            )
          })}
        </span>
        <span className="friends-on__text">{line}</span>
        <span className="muted" aria-hidden="true">›</span>
      </button>
      {open && (
        <Sheet title="Tes amis" onClose={() => setOpen(false)}>
          <ul className="choices">
            {sorted.map((r) => {
              const p = profileOf(r.userId)
              return (
                <li key={r.userId}>
                  <a className="choice" href={p ? href.friend(p.username) : undefined}>
                    <span className="avatar friends-on__face" aria-hidden="true">{(p ? nameOf(p) : '?').slice(0, 1).toUpperCase()}</span>
                    <span className="choice__text">
                      {p ? nameOf(p) : 'Un ami'}
                      <span className="choice__hint">{r.detail}</span>
                    </span>
                    {r.rating && <span aria-label="sa note">{RATING_ICON[r.rating]}</span>}
                  </a>
                </li>
              )
            })}
          </ul>
        </Sheet>
      )}
    </>
  )
}
