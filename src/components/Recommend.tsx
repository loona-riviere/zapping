import { useEffect, useState } from 'react'
import { useApp } from '../lib/appState'
import { useBooks } from '../lib/booksState'
import { friendsWhoHave, type Rec, type RecKind, type RecMeta } from '../lib/recs'
import { href } from '../lib/route'
import { nameOf } from '../lib/social'
import { useSocial } from '../lib/socialState'
import type { TvShow } from '../lib/tvmaze'
import { Poster } from './Poster'
import { Sheet } from './Sheet'

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
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const close = () => {
    setOpen(false)
    setSent(null)
    setPicked(new Set())
    setNote('')
  }

  return (
    <>
      <button className="pill" onClick={() => setOpen(true)}>
        📨 Recommander
      </button>
      {open && (
        <Sheet title={`Recommander ${item.title}`} onClose={close}>
          {sent ? (
            <>
              <p className="together__done">📨 Envoyé à {sent}.</p>
              <button className="btn btn--ghost sheet__cta" onClick={close}>Fermer</button>
            </>
          ) : (
            <>
              <section className="sheet__section">
                <p className="sheet__label">À qui ?</p>
                {have === null && <p className="muted">Je regarde qui l'a déjà…</p>}
                {have && (
                  <div className="chips">
                    {friends.map((f) => {
                      const already = have.has(f.user_id)
                      return (
                        <button
                          key={f.user_id}
                          className={`pill${picked.has(f.user_id) ? ' pill--on' : ''}`}
                          disabled={already}
                          onClick={() => toggle(f.user_id)}
                          title={already ? 'Déjà dans sa liste' : undefined}
                        >
                          {nameOf(f)}
                          {already && <span className="muted rec__has"> · l'a déjà</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>
              <section className="sheet__section">
                <p className="sheet__label">Un petit mot</p>
                <textarea
                  className="rec__note"
                  placeholder="Facultatif"
                  maxLength={280}
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </section>
              <button
                className="btn btn--primary sheet__cta"
                disabled={!picked.size}
                onClick={async () => {
                  await sendRecs([...picked], item, note)
                  setSent(friends.filter((f) => picked.has(f.user_id)).map(nameOf).join(', '))
                }}
              >
                Envoyer
              </button>
            </>
          )}
        </Sheet>
      )}
    </>
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
