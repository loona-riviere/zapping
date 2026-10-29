import { useEffect, useMemo, useState } from 'react'
import { fetchAdminUsers, type AdminUser } from '../lib/admin'
import { formatShortDate } from '../lib/progress'
import { formatNumber } from '../lib/stats'
import { SkeletonRows } from './Skeleton'

const DAY = 24 * 60 * 60 * 1000

/** Dernier signe de vie : connexion ou dernier épisode / film coché. */
function lastSeen(u: AdminUser): string | null {
  const dates = [u.last_sign_in_at, u.last_watched_at].filter((d): d is string => !!d)
  return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null
}

function since(iso: string | null, days: number): boolean {
  return !!iso && Date.now() - new Date(iso).getTime() < days * DAY
}

export function Admin() {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    fetchAdminUsers().then(setUsers, (e: Error) => setError(e.message))
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!users || !q) return users ?? []
    return users.filter((u) =>
      [u.email, u.username, u.display_name].some((s) => s?.toLowerCase().includes(q)),
    )
  }, [users, query])

  if (error) {
    return (
      <section className="empty">
        <h2>Accès refusé</h2>
        <p className="muted">{error}</p>
      </section>
    )
  }
  if (!users) return <SkeletonRows count={6} />

  const tiles = [
    { label: 'Comptes', value: users.length },
    { label: 'Nouveaux (7 j)', value: users.filter((u) => since(u.created_at, 7)).length },
    { label: 'Actifs (7 j)', value: users.filter((u) => since(lastSeen(u), 7)).length },
    { label: 'Actifs (30 j)', value: users.filter((u) => since(lastSeen(u), 30)).length },
    { label: 'Notifs activées', value: users.filter((u) => u.push).length },
    { label: 'Épisodes cochés', value: users.reduce((n, u) => n + u.episodes, 0) },
  ]

  return (
    <div className="admin">
      <h2 className="section-title">Administration</h2>
      <ul className="tiles-stat">
        {tiles.map((t) => (
          <li key={t.label} className="tile-stat">
            <p className="tile-stat__label">{t.label}</p>
            <p className="tile-stat__value">{formatNumber(t.value)}</p>
          </li>
        ))}
      </ul>

      <h2 className="section-title">Utilisateurs</h2>
      <label htmlFor="admin-q" className="visually-hidden">Chercher</label>
      <input
        id="admin-q"
        type="search"
        className="search__input"
        placeholder="E-mail ou pseudo…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
      />
      <ul className="rows">
        {shown.map((u) => {
          const seen = lastSeen(u)
          return (
            <li key={u.user_id} className="row row--stack">
              <div className="admin__who">
                <strong>{u.display_name || (u.username ? `@${u.username}` : 'Sans pseudo')}</strong>
                {u.username && u.display_name && <span className="muted"> @{u.username}</span>}
                {u.push && <span title="Notifications activées"> 🔔</span>}
              </div>
              <p className="muted admin__line">{u.email ?? 'sans e-mail'}</p>
              <p className="muted admin__line">
                Inscrit le {formatShortDate(u.created_at)} · vu{' '}
                {seen ? `le ${formatShortDate(seen)}` : 'jamais'}
              </p>
              <p className="admin__line">
                {formatNumber(u.shows)} séries · {formatNumber(u.episodes)} épisodes ·{' '}
                {formatNumber(u.movies)} films · {formatNumber(u.books)} livres ·{' '}
                {formatNumber(u.friends)} amis
              </p>
            </li>
          )
        })}
      </ul>
      {query.trim() && !shown.length && <p className="muted">Personne ne correspond.</p>}
    </div>
  )
}
