import { useEffect, useState } from 'react'
import { fetchFeed, whenLabel, type FeedItem } from '../lib/feed'
import { href } from '../lib/route'
import { nameOf, type Profile } from '../lib/social'
import type { Rating } from '../lib/store'
import { Poster } from './Poster'
import { Limited } from './ShowMore'
import { SkeletonRows } from './Skeleton'

const RATING: Record<Rating, { icon: string; label: string }> = {
  dislike: { icon: '👎', label: "n'a pas aimé" },
  meh: { icon: '😐', label: 'bof' },
  like: { icon: '👍', label: 'a aimé' },
  love: { icon: '❤️', label: 'a adoré' },
}

const linkOf = (i: FeedItem) =>
  i.kind === 'show' ? href.show(i.itemId as number) : i.kind === 'movie' ? href.movie(i.itemId as number) : href.book(i.itemId as string)

/** « Quoi de neuf » : ce que les amis ont regardé et lu ces 30 derniers jours. */
export function FriendsFeed({ friends }: { friends: Profile[] }) {
  const [items, setItems] = useState<FeedItem[] | null>(null)
  const ids = friends.map((f) => f.user_id).sort().join(',')

  useEffect(() => {
    let alive = true
    setItems(null)
    fetchFeed(ids ? ids.split(',') : [])
      .then((r) => alive && setItems(r))
      .catch(() => alive && setItems([]))
    return () => {
      alive = false
    }
  }, [ids])

  if (!friends.length) return null
  const byId = new Map(friends.map((f) => [f.user_id, f]))

  return (
    <section className="feed">
      <h2 className="section-title">Quoi de neuf</h2>
      {items === null ? (
        <SkeletonRows count={3} />
      ) : !items.length ? (
        <p className="muted">Rien de nouveau chez tes amis ces 30 derniers jours.</p>
      ) : (
        <Limited id="friends-feed" items={items} limit={8}>
          {(visible) => (
            <ul className="rows">
              {visible.map((i) => {
                const who = byId.get(i.userId)
                return (
                  <li key={i.key} className="row">
                    <a href={linkOf(i)} className="row__link">
                      <Poster src={i.image} alt={i.title} />
                      <div className="row__body">
                        <h3>
                          <span className="feed__who">{who ? nameOf(who) : 'Un ami'}</span> {i.verb} <em>{i.title}</em>
                          {i.rating && <span role="img" aria-label={RATING[i.rating].label}> {RATING[i.rating].icon}</span>}
                        </h3>
                        <p className="muted feed__when">
                          {i.detail && <>{i.detail} · </>}
                          {whenLabel(i.at)}
                        </p>
                      </div>
                    </a>
                  </li>
                )
              })}
            </ul>
          )}
        </Limited>
      )}
    </section>
  )
}
