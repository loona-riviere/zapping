import { useEffect, useState } from 'react'
import { useApp } from '../lib/appState'
import { href } from '../lib/route'
import { moviesNowPlaying, moviesUpcoming, tmdbConfigured, type Movie } from '../lib/tmdb'
import { Poster } from './Poster'

const shortDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })

/**
 * L'actualité ciné : ce qui est à l'affiche et ce qui sort bientôt en France,
 * en deux rangées d'affiches. Un film déjà dans ta liste porte sa pastille
 * (✓ vu, 🔖 à voir). Tes films « à voir » qui sortent bientôt passent devant.
 */
export function MovieReleases() {
  const { movies } = useApp()
  const [now, setNow] = useState<Movie[] | null>(null)
  const [soon, setSoon] = useState<Movie[] | null>(null)

  useEffect(() => {
    if (!tmdbConfigured) return
    let alive = true
    moviesNowPlaying().then((m) => alive && setNow(m)).catch(() => alive && setNow([]))
    moviesUpcoming().then((m) => alive && setSoon(m)).catch(() => alive && setSoon([]))
    return () => {
      alive = false
    }
  }, [])

  if (!tmdbConfigured) return null
  const mine = new Map(movies.map((m) => [m.movie_id, m.status]))
  const today = new Date().toISOString().slice(0, 10)
  // Mes « à voir » pas encore sortis : en tête de « Bientôt », même s'ils manquent à la liste TMDB.
  const myUpcoming: Movie[] = movies
    .filter((m) => m.status === 'later' && m.release_date && m.release_date > today)
    .map((m) => ({ id: m.movie_id, title: m.title, poster_url: m.poster_url, year: m.release_year, release_date: m.release_date, overview: null }))
  const soonAll = [...myUpcoming, ...(soon ?? []).filter((m) => !mine.has(m.id))]
    .sort((a, b) => (a.release_date ?? '').localeCompare(b.release_date ?? ''))

  const tile = (m: Movie, caption: string) => {
    const status = mine.get(m.id)
    return (
      <li key={m.id} className="shelf__item">
        <a href={href.movie(m.id)} title={m.title}>
          <span className="release__poster">
            <Poster src={m.poster_url} alt={m.title} />
            {status && <span className="release__badge">{status === 'watched' ? '✓' : '🔖'}</span>}
          </span>
          <span className="shelf__label">{m.title}</span>
          <span className="shelf__because">{caption}</span>
        </a>
      </li>
    )
  }

  return (
    <>
      <section>
        <h2 className="section-title">Au cinéma</h2>
        {now === null ? (
          <p className="muted">Chargement…</p>
        ) : now.length ? (
          <ul className="shelf shelf--carousel">
            {now.slice(0, 20).map((m) => tile(m, m.release_date ? `sorti le ${shortDate(m.release_date)}` : ''))}
          </ul>
        ) : (
          <p className="muted">Rien à afficher pour l'instant.</p>
        )}
      </section>
      <section>
        <h2 className="section-title">Bientôt au cinéma</h2>
        {soon === null ? (
          <p className="muted">Chargement…</p>
        ) : soonAll.length ? (
          <ul className="shelf shelf--carousel">
            {soonAll.slice(0, 25).map((m) => tile(m, m.release_date ? `le ${shortDate(m.release_date)}` : 'bientôt'))}
          </ul>
        ) : (
          <p className="muted">Aucune sortie annoncée.</p>
        )}
      </section>
    </>
  )
}
