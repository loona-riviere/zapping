import { useEffect, useState } from 'react'
import { addComment, ago, deleteComment, fetchComments, type Comment, type CommentKind } from '../lib/comments'
import { notify } from '../lib/notify'
import { nameOf } from '../lib/social'
import { useSocial } from '../lib/socialState'

/**
 * Les commentaires d'un épisode, d'un film ou d'un livre, entre amis.
 * Anti-spoiler : sur un épisode pas encore vu (ou un commentaire marqué
 * « spoiler » sur un film pas vu, un livre pas lu), le texte est flouté ;
 * un appui l'affiche.
 */
export function Comments({
  kind,
  itemId,
  showId,
  title,
  seen,
}: {
  kind: CommentKind
  itemId: string
  showId?: number
  /** « Friends S02E03 », « Dune » : pour la notif des amis. */
  title: string
  /** Vu / lu : les spoilers s'affichent sans flou. */
  seen: boolean
}) {
  const { socialReady, profile, friends, profileOf } = useSocial()
  const [list, setList] = useState<Comment[] | null>(null)
  const [text, setText] = useState('')
  const [spoiler, setSpoiler] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Set<number>>(new Set())

  useEffect(() => {
    let alive = true
    setList(null)
    fetchComments(kind, itemId)
      .then((c) => alive && setList(c))
      .catch(() => alive && setList([]))
    return () => {
      alive = false
    }
  }, [kind, itemId])

  if (!socialReady || !profile || list === null) return null
  // Sans amis, personne ne lirait : on n'affiche la section que s'il y a de quoi.
  if (!friends.length && !list.length) return null

  const who = (userId: string) => (userId === profile.user_id ? profile : profileOf(userId))
  const hidden = (c: Comment) =>
    c.user_id !== profile.user_id && !seen && (kind === 'episode' || c.spoiler) && !revealed.has(c.id)

  async function send() {
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    try {
      const c = await addComment({ kind, itemId, showId, title, body: text, spoiler: kind === 'episode' || spoiler })
      setList((prev) => [...(prev ?? []), c])
      setText('')
      setSpoiler(false)
      notify({ event: 'comment', to: profile!.user_id, commentId: c.id })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="comments">
      <h2 className="section-title">
        Commentaires {list.length > 0 && <span className="muted">({list.length})</span>}
      </h2>
      {list.length === 0 && <p className="muted comments__empty">Personne n'a encore rien dit. Lance la discussion !</p>}
      <ul className="comments__list">
        {list.map((c) => {
          const p = who(c.user_id)
          const name = p ? nameOf(p) : 'Un ami'
          const mine = c.user_id === profile.user_id
          return (
            <li key={c.id} className={`comment${mine ? ' comment--mine' : ''}`}>
              <span className="avatar comment__avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
              <div className="comment__bubble">
                <p className="comment__meta">
                  <strong>{mine ? 'Toi' : name}</strong> · <span className="muted">{ago(c.created_at)}</span>
                  {c.spoiler && kind !== 'episode' && <span className="comment__tag">spoiler</span>}
                </p>
                {hidden(c) ? (
                  <button type="button" className="comment__spoiler" onClick={() => setRevealed((s) => new Set(s).add(c.id))}>
                    <span className="comment__blur" aria-hidden="true">{c.body}</span>
                    <span className="comment__reveal">
                      🙈 {kind === 'episode' ? "Tu n'as pas encore vu cet épisode" : 'Spoiler'} · Afficher
                    </span>
                  </button>
                ) : (
                  <p className="comment__body">{c.body}</p>
                )}
                {mine && (
                  <button
                    type="button"
                    className="link-btn muted comment__delete"
                    onClick={async () => {
                      if (!confirm('Supprimer ton commentaire ?')) return
                      await deleteComment(c.id).catch(() => null)
                      setList((prev) => (prev ?? []).filter((x) => x.id !== c.id))
                    }}
                  >
                    Supprimer
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <div className="comments__composer">
        <textarea
          className="rec__note"
          rows={2}
          maxLength={1000}
          placeholder={kind === 'episode' ? 'Ton avis sur cet épisode…' : 'Ton avis…'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="comments__row">
          {kind !== 'episode' ? (
            <label className="comments__spoiler">
              <input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} />
              Contient des spoilers
            </label>
          ) : (
            <span className="muted comments__hint">Caché à ceux qui ne l'ont pas encore vu.</span>
          )}
          <button className="btn btn--primary" disabled={busy || !text.trim()} onClick={send}>
            {busy ? 'Envoi…' : 'Publier'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </section>
  )
}
