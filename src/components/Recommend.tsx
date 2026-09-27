import { useEffect, useState } from 'react'
import { useApp } from '../lib/appState'
import { useBooks } from '../lib/booksState'
import { friendsWhoHave, type Rec, type RecKind, type RecMeta } from '../lib/recs'
import { href } from '../lib/route'
import { nameOf } from '../lib/social'
import { useSocial } from '../lib/socialState'
import type { TvShow } from '../lib/tvmaze'
import { Poster } from './Poster'

type Item = { kind: RecKind; itemId: string; title: string; image: string | null; meta: RecMeta }

/**
 * « 📨 Recommander » sur une fiche : choisir un ou plusieurs amis, avec un
 * petit mot. Ceux qui ont déjà le titre dans leur liste sont grisés.
 */
export function RecommendButton({ item }: { item: Item }) {
  const { socialReady, profile, friends, incomingRecs, sendRecs } = useSocial()
  const [open, setOpen] = useState(false)
  const [have, setHave] = useState<Set<string> | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const [sent, setSent] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setHave(null)
    friendsWhoHave(item.kind, item.itemId, friends.map((f) => f.user_id)).then(setHave)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item.kind, item.itemId, friends.length])

  if (!socialReady || !profile || incomingRecs === null || !friends.length) return null
  if (sent) return <p className="muted rec__sent">📨 Recommandé à {sent}.</p>
  if (!open) {
    return (
      <button className="btn btn--ghost rec__open" onClick={() => setOpen(true)}>
        📨 Recommander
      </button>
    )
  }

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="duo rec">
      <p>Recommander {item.title} à…</p>
      {have === null && <p className="muted">Je regarde qui l'a déjà…</p>}
      {have && (
        <div className="kinds">
          {friends.map((f) => {
            const already = have.has(f.user_id)
            return (
              <label key={f.user_id} className="kinds__item" title={already ? "Déjà dans sa liste" : undefined}>
                <input
                  type="checkbox"
                  checked={picked.has(f.user_id)}
                  disabled={already}
                  onChange={() => toggle(f.user_id)}
                />
                {nameOf(f)}
                {already && <span className="muted rec__has">déjà dans sa liste</span>}
              </label>
            )
          })}
        </div>
      )}
      <textarea
        className="rec__note"
        placeholder="Un petit mot ? (facultatif)"
        maxLength={280}
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="movie__actions">
        <button
          className="btn btn--primary"
          disabled={!picked.size}
          onClick={async () => {
            await sendRecs([...picked], item, note)
            setSent(friends.filter((f) => picked.has(f.user_id)).map(nameOf).join(', '))
          }}
        >
          Envoyer
        </button>
        <button className="link-btn muted" onClick={() => setOpen(false)}>Annuler</button>
      </div>
    </div>
  )
}

const LINK: Record<RecKind, (id: string) => string> = {
  show: (id) => href.show(Number(id)),
  movie: (id) => href.movie(Number(id)),
  book: (id) => href.book(id),
}
const KIND_WORD: Record<RecKind, string> = { show: 'la série', movie: 'le film', book: 'le livre' }

/** Recommandations reçues : ajouter à sa liste « à voir / à lire », ou non merci. */
export function IncomingRecs() {
  const { incomingRecs, profileOf, dismissRec } = useSocial()
  const { track, addToWatchlist, isTracked, movies } = useApp()
  const { addBook, bookById } = useBooks()
  if (!incomingRecs?.length) return null

  async function add(r: Rec) {
    const m = r.meta
    if (m.kind === 'show' && !isTracked(m.id)) {
      await track({ id: m.id, name: m.name, image: m.image ? { medium: m.image, original: m.image } : null } as TvShow)
    } else if (m.kind === 'movie' && !movies.some((x) => x.movie_id === m.movie.id)) {
      await addToWatchlist(m.movie)
    } else if (m.kind === 'book' && !bookById(m.book.id)) {
      await addBook(m.book, 'later')
    }
    await dismissRec(r)
  }

  return (
    <section>
      <h2 className="section-title">Pour toi <span className="muted">({incomingRecs.length})</span></h2>
      <ul className="rows">
        {incomingRecs.map((r) => {
          const who = profileOf(r.sender)
          return (
            <li key={r.id} className="row">
              <a href={LINK[r.kind](r.item_id)} className="row__link">
                <Poster src={r.image_url} alt={r.title} />
                <div className="row__body">
                  <h3>{r.title}</h3>
                  <p className="muted">
                    {who ? nameOf(who) : 'Un ami'} te recommande {KIND_WORD[r.kind]}
                  </p>
                  {r.note && <p className="rec__quote">« {r.note} »</p>}
                </div>
              </a>
              <div className="row__actions">
                <button className="btn btn--primary" onClick={() => add(r)}>
                  {r.kind === 'book' ? 'À lire' : 'À voir'}
                </button>
                <button className="link-btn muted row__drop" onClick={() => dismissRec(r)}>Non merci</button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
