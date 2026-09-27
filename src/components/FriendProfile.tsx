import { useEffect, useState } from 'react'
import { href } from '../lib/route'
import { fetchFriendLibrary, findProfile, nameOf, type FriendLibrary, type Profile } from '../lib/social'
import { useSocial } from '../lib/socialState'
import { Avatar, RelationButton } from './Friends'
import { Poster } from './Poster'
import { SkeletonPage } from './Skeleton'

type Tile = { key: string; href: string; src: string | null; title: string; caption?: string }

/** Une étagère d'affiches qui défile de côté, comme les suggestions. */
function Shelf({ title, items }: { title: string; items: Tile[] }) {
  if (!items.length) return null
  return (
    <section>
      <h2 className="section-title">{title}</h2>
      <ul className="shelf shelf--carousel">
        {items.map((t) => (
          <li key={t.key} className="shelf__item">
            <a href={t.href} title={t.title}>
              <Poster src={t.src} alt={t.title} />
              <span className="shelf__label">{t.title}</span>
              {t.caption && <span className="shelf__because">{t.caption}</span>}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

const recent = (a: string | null | undefined, b: string | null | undefined) => (b ?? '').localeCompare(a ?? '')

export function FriendProfile({ username }: { username: string }) {
  const { profile: me, relationWith, remove, socialReady } = useSocial()
  const [other, setOther] = useState<Profile | null | undefined>(undefined)
  const [library, setLibrary] = useState<FriendLibrary | null>(null)
  const relation = other ? relationWith(other.user_id) : 'none'

  useEffect(() => {
    let alive = true
    setOther(undefined)
    findProfile(username)
      .then((p) => alive && setOther(p))
      .catch(() => alive && setOther(null))
    return () => {
      alive = false
    }
  }, [username])

  useEffect(() => {
    if (!other || relation !== 'friends') {
      setLibrary(null)
      return
    }
    let alive = true
    fetchFriendLibrary(other.user_id)
      .then((l) => alive && setLibrary(l))
      .catch(() => alive && setLibrary({ shows: [], movies: [], books: [] }))
    return () => {
      alive = false
    }
  }, [other, relation])

  if (!socialReady) return <p className="muted pad">Les amis ne sont pas encore installés : relance schema.sql.</p>
  if (other === undefined) return <SkeletonPage />
  if (!other) return <p className="muted pad">Personne avec le pseudo « {username} ». <a href={href.friends}>Retour</a></p>
  if (me && other.user_id === me.user_id) {
    return (
      <p className="muted pad">
        C'est ton propre profil 🙂 Partage ce lien à tes amis pour qu'ils t'ajoutent. <a href={href.friends}>Mes amis</a>
      </p>
    )
  }

  const name = nameOf(other)
  const lib = library

  return (
    <article className="friend">
      <header className="friend__me">
        <Avatar profile={other} size="lg" />
        <div>
          <h1>{name}</h1>
          <p className="muted">@{other.username}</p>
        </div>
        {relation !== 'friends' && (me ? <RelationButton other={other} /> : null)}
      </header>

      {!me && (
        <p className="muted">
          Choisis d'abord ton pseudo dans <a href={href.friends}>Amis</a>, puis reviens sur ce lien pour
          ajouter {name}.
        </p>
      )}
      {relation === 'sent' && <p className="muted">Demande envoyée : {name} doit l'accepter.</p>}
      {relation === 'received' && <p className="muted">{name} t'a demandé en ami.</p>}
      {relation === 'none' && me && (
        <p className="muted">Une fois amis, vous verrez chacun ce que l'autre regarde et lit.</p>
      )}

      {relation === 'friends' && !lib && <p className="muted">Chargement de sa bibliothèque…</p>}
      {relation === 'friends' && lib && (
        <>
          <ul className="friend__counts">
            <li><strong>{lib.shows.length}</strong> séries</li>
            <li><strong>{lib.movies.filter((m) => m.status === 'watched').length}</strong> films</li>
            <li><strong>{lib.books.filter((b) => b.status === 'read').length}</strong> livres</li>
          </ul>

          <Shelf
            title="Regarde en ce moment"
            items={lib.shows
              .filter((s) => s.status === 'watching')
              .sort((a, b) => recent(a.last_watched_at, b.last_watched_at))
              .slice(0, 12)
              .map((s) => ({ key: `s${s.show_id}`, href: href.show(s.show_id), src: s.image_url, title: s.name }))}
          />
          <Shelf
            title="Lit en ce moment"
            items={lib.books
              .filter((b) => b.status === 'reading')
              .map((b) => ({
                key: b.book_id,
                href: href.book(b.book_id),
                src: b.cover_url,
                title: b.title,
                caption: b.page_count ? `${Math.round((b.current_page / b.page_count) * 100)} %` : undefined,
              }))}
          />
          <Shelf
            title="Coups de cœur"
            items={[
              ...lib.shows.filter((s) => s.rating === 'love').map((s) => ({ key: `s${s.show_id}`, href: href.show(s.show_id), src: s.image_url, title: s.name })),
              ...lib.movies.filter((m) => m.rating === 'love').map((m) => ({ key: `m${m.movie_id}`, href: href.movie(m.movie_id), src: m.poster_url, title: m.title })),
              ...lib.books.filter((b) => b.rating === 'love').map((b) => ({ key: b.book_id, href: href.book(b.book_id), src: b.cover_url, title: b.title })),
            ]}
          />
          <Shelf
            title="Films vus récemment"
            items={lib.movies
              .filter((m) => m.status === 'watched')
              .sort((a, b) => recent(a.watched_at, b.watched_at))
              .slice(0, 12)
              .map((m) => ({ key: `m${m.movie_id}`, href: href.movie(m.movie_id), src: m.poster_url, title: m.title }))}
          />
          <Shelf
            title="Livres lus récemment"
            items={lib.books
              .filter((b) => b.status === 'read')
              .sort((a, b) => recent(a.finished_at, b.finished_at))
              .slice(0, 12)
              .map((b) => ({ key: b.book_id, href: href.book(b.book_id), src: b.cover_url, title: b.title }))}
          />
          {!lib.shows.length && !lib.movies.length && !lib.books.length && (
            <p className="muted">Rien à voir pour l'instant : {name} n'a encore rien ajouté (ou tout caché).</p>
          )}

          <button
            className="link-btn muted show__untrack"
            onClick={() => confirm(`Retirer ${name} de tes amis ? Vous ne verrez plus vos bibliothèques.`) && remove(other)}
          >
            Retirer de mes amis
          </button>
        </>
      )}
    </article>
  )
}
