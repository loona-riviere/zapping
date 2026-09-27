import { useEffect, useState } from 'react'
import { href } from '../lib/route'
import { inviteLink, nameOf, normalizeUsername, saveProfile, searchProfiles, USERNAME_RE, type Profile } from '../lib/social'
import { useSocial } from '../lib/socialState'

/** Pastille avec l'initiale : pas de photo pour l'instant, une lettre suffit à se repérer. */
export function Avatar({ profile, size = 'sm' }: { profile: Pick<Profile, 'username' | 'display_name'>; size?: 'sm' | 'lg' }) {
  return (
    <span className={`avatar avatar--${size}`} aria-hidden="true">
      {nameOf(profile).slice(0, 1).toUpperCase()}
    </span>
  )
}

/** Choisir (ou changer) son pseudo et son nom affiché. */
export function ProfileForm({ onDone }: { onDone?: () => void }) {
  const { profile, setProfile } = useSocial()
  const [username, setUsername] = useState(profile?.username ?? '')
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const valid = USERNAME_RE.test(username)

  return (
    <form
      className="manual-book"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!valid) return
        setSaving(true)
        setError(null)
        try {
          setProfile(await saveProfile(username, displayName))
          onDone?.()
        } catch (err) {
          setError((err as Error).message)
        } finally {
          setSaving(false)
        }
      }}
    >
      <label>
        Pseudo
        <input
          value={username}
          onChange={(e) => setUsername(normalizeUsername(e.target.value))}
          placeholder="loona"
          autoCapitalize="none"
          autoCorrect="off"
          maxLength={20}
          required
        />
      </label>
      <p className="muted" style={{ margin: '-.3rem 0 0', fontSize: '.8rem' }}>
        3 à 20 caractères : lettres, chiffres, point ou tiret bas. C'est lui que tes amis cherchent.
      </p>
      <label>
        Nom affiché
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Facultatif" maxLength={40} />
      </label>
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      <div className="movie__actions">
        <button className="btn btn--primary" disabled={!valid || saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {onDone && profile && (
          <button type="button" className="btn btn--ghost" onClick={onDone}>
            Annuler
          </button>
        )}
      </div>
    </form>
  )
}

function RelationButton({ other }: { other: Profile }) {
  const { relationWith, ask, accept } = useSocial()
  const rel = relationWith(other.user_id)
  if (rel === 'friends') return <span className="muted friend__tag">Ami·e</span>
  if (rel === 'sent') return <span className="muted friend__tag">Demande envoyée</span>
  if (rel === 'received')
    return (
      <button className="btn btn--primary" onClick={() => accept(other)}>
        Accepter
      </button>
    )
  return (
    <button className="btn btn--primary" onClick={() => ask(other)}>
      Ajouter
    </button>
  )
}

export function Friends() {
  const { socialReady, loading, profile, friends, incoming, friendships, accept, remove } = useSocial()
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Profile[]>([])
  const [shared, setShared] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    let alive = true
    const t = setTimeout(() => {
      searchProfiles(q)
        .then((r) => alive && setResults(r))
        .catch(() => alive && setResults([]))
    }, 300)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query])

  if (!socialReady) {
    return (
      <section className="empty">
        <h2>Amis pas encore installés</h2>
        <p>
          Relance <code>supabase/schema.sql</code> dans l'éditeur SQL de ton projet Supabase : il crée
          les profils et les demandes d'amis. Tes séries, films et livres ne bougent pas.
        </p>
      </section>
    )
  }
  if (loading) return <p className="muted pad">Chargement…</p>

  if (!profile || editing) {
    return (
      <div className="friends">
        <h2 className="section-title">{profile ? 'Mon profil' : 'Choisis ton pseudo'}</h2>
        {!profile && (
          <p className="muted">
            Tes amis te trouvent grâce à lui. Une fois amis, vous voyez chacun ce que l'autre regarde et
            lit — sauf ce que tu choisis de cacher sur une fiche.
          </p>
        )}
        <ProfileForm onDone={profile ? () => setEditing(false) : undefined} />
      </div>
    )
  }

  const sent = friendships.filter((f) => f.status === 'pending' && f.sentByMe)

  async function share() {
    const link = inviteLink(profile!.username)
    const text = `Ajoute-moi sur Zapping : ${link}`
    try {
      if (navigator.share) await navigator.share({ title: 'Zapping', text, url: link })
      else {
        await navigator.clipboard.writeText(link)
        setShared(true)
        setTimeout(() => setShared(false), 2500)
      }
    } catch {
      /* partage annulé */
    }
  }

  return (
    <div className="friends">
      <section className="friend__me">
        <Avatar profile={profile} size="lg" />
        <div>
          <h2>{nameOf(profile)}</h2>
          <p className="muted">@{profile.username}</p>
        </div>
        <button className="link-btn muted" onClick={() => setEditing(true)}>
          Modifier
        </button>
      </section>
      <button className="btn btn--primary" onClick={share}>
        {shared ? 'Lien copié ✓' : 'Inviter un ami (partager mon lien)'}
      </button>

      {incoming.length > 0 && (
        <section>
          <h2 className="section-title">Demandes reçues <span className="muted">({incoming.length})</span></h2>
          <ul className="rows">
            {incoming.map((f) => (
              <li key={f.other.user_id} className="row">
                <a href={href.friend(f.other.username)} className="row__link">
                  <Avatar profile={f.other} />
                  <div className="row__body">
                    <h3>{nameOf(f.other)}</h3>
                    <p className="muted">@{f.other.username}</p>
                  </div>
                </a>
                <div className="row__actions">
                  <button className="btn btn--primary" onClick={() => accept(f.other)}>Accepter</button>
                  <button className="link-btn muted row__drop" onClick={() => remove(f.other)}>Refuser</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="section-title">Ajouter un ami</h2>
        <label htmlFor="friend-q" className="visually-hidden">Pseudo</label>
        <input
          id="friend-q"
          type="search"
          className="search__input"
          placeholder="Chercher un pseudo…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
        />
        {query.trim().length >= 2 && !results.length && (
          <p className="muted">Personne avec ce pseudo. Envoie-lui plutôt ton lien d'invitation.</p>
        )}
        <ul className="rows">
          {results.map((p) => (
            <li key={p.user_id} className="row">
              <a href={href.friend(p.username)} className="row__link">
                <Avatar profile={p} />
                <div className="row__body">
                  <h3>{nameOf(p)}</h3>
                  <p className="muted">@{p.username}</p>
                </div>
              </a>
              <RelationButton other={p} />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="section-title">Mes amis {friends.length > 0 && <span className="muted">({friends.length})</span>}</h2>
        {!friends.length && <p className="muted">Pas encore d'amis ici. Partage ton lien pour commencer.</p>}
        <ul className="rows">
          {friends.map((p) => (
            <li key={p.user_id} className="row">
              <a href={href.friend(p.username)} className="row__link">
                <Avatar profile={p} />
                <div className="row__body">
                  <h3>{nameOf(p)}</h3>
                  <p className="muted">@{p.username}</p>
                </div>
              </a>
            </li>
          ))}
        </ul>
      </section>

      {sent.length > 0 && (
        <section>
          <h2 className="section-title">Demandes envoyées</h2>
          <ul className="rows">
            {sent.map((f) => (
              <li key={f.other.user_id} className="row">
                <div className="row__link">
                  <Avatar profile={f.other} />
                  <div className="row__body">
                    <h3>{nameOf(f.other)}</h3>
                    <p className="muted">En attente de réponse</p>
                  </div>
                </div>
                <button className="link-btn muted row__drop" onClick={() => remove(f.other)}>Annuler</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export { RelationButton }
