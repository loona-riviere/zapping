import { useMemo } from 'react'
import { useMovies } from '../lib/moviesState'
import { epCode } from '../lib/progress'
import { href } from '../lib/route'
import { useShows } from '../lib/showsState'
import type { TvEpisode } from '../lib/tvmaze'
import { useShowEpisodes } from '../lib/useShows'
import { Poster } from './Poster'
import { SkeletonRows } from './Skeleton'

type Entry = {
  key: string
  href: string
  title: string
  image: string | null
  detail: string
  kind: 'show' | 'movie'
}

/** Jour local (AAAA-MM-JJ) : un épisode US de 21 h sort chez nous le lendemain. */
function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function dayOfEpisode(ep: TvEpisode): string | null {
  if (ep.airstamp) {
    const d = new Date(ep.airstamp)
    if (!Number.isNaN(d.getTime())) return localDay(d)
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(ep.airdate) ? ep.airdate : null
}

function dayLabel(day: string, today: string, tomorrow: string): string {
  if (day === today) return "Aujourd'hui"
  if (day === tomorrow) return 'Demain'
  const d = new Date(`${day}T12:00:00`)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Une série qui sort plusieurs épisodes le même jour (saison mise en ligne
 * d'un coup) tient sur une ligne : « S02E01 → E08, saison entière ».
 */
function episodesDetail(eps: TvEpisode[], all: TvEpisode[]): string {
  if (eps.length === 1) return `${epCode(eps[0])}${eps[0].name ? ` · ${eps[0].name}` : ''}`
  const first = eps[0]
  const last = eps[eps.length - 1]
  const range = first.season === last.season ? `${epCode(first)} → E${String(last.number).padStart(2, '0')}` : `${epCode(first)} → ${epCode(last)}`
  const wholeSeason = first.number === 1 && all.filter((e) => e.season === first.season).length === eps.length
  return `${range}, ${wholeSeason ? 'saison entière' : `${eps.length} épisodes`}`
}

/**
 * Le calendrier des sorties : prochains épisodes des séries en cours ou en
 * pause, et films de la liste « à voir » pas encore sortis, jour par jour.
 */
export function Calendar() {
  const { tracked, loading } = useShows()
  const { movies } = useMovies()
  const followed = useMemo(() => tracked.filter((t) => t.status === 'watching' || t.status === 'paused'), [tracked])
  const ids = useMemo(() => followed.map((t) => t.show_id), [followed])
  const { data, ready } = useShowEpisodes(ids)

  const now = new Date()
  const today = localDay(now)
  const tomorrow = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))

  const byDay = new Map<string, Entry[]>()
  const add = (day: string, e: Entry) => byDay.set(day, [...(byDay.get(day) ?? []), e])

  for (const t of followed) {
    const d = data[t.show_id]
    if (!d) continue
    const perDay = new Map<string, TvEpisode[]>()
    for (const ep of d.episodes) {
      const day = dayOfEpisode(ep)
      if (!day || day < today) continue
      perDay.set(day, [...(perDay.get(day) ?? []), ep])
    }
    for (const [day, eps] of perDay) {
      add(day, {
        key: `s${t.show_id}-${day}`,
        href: href.show(t.show_id),
        title: t.name,
        image: d.show.image?.medium ?? t.image_url,
        detail: episodesDetail(eps, d.episodes),
        kind: 'show',
      })
    }
  }
  for (const m of movies) {
    if (m.status !== 'later' || !m.release_date || m.release_date < today) continue
    add(m.release_date, {
      key: `m${m.movie_id}`,
      href: href.movie(m.movie_id),
      title: m.title,
      image: m.poster_url,
      detail: 'Sortie du film',
      kind: 'movie',
    })
  }

  const days = [...byDay.keys()].sort()

  return (
    <div className="calendar">
      <h2 className="section-title calendar__title">Calendrier</h2>
      <p className="muted calendar__intro">
        Les prochains épisodes de tes séries en cours ou en pause, et les films de ta liste « à voir » qui sortent bientôt.
      </p>

      {loading || (ids.length > 0 && !ready) ? (
        <SkeletonRows count={5} />
      ) : !days.length ? (
        <section className="empty">
          <h2>Rien d'annoncé</h2>
          <p>
            Aucune date de sortie connue pour l'instant. Dès qu'un nouvel épisode d'une de tes séries
            ou un film de ta liste a une date, il apparaît ici.
          </p>
        </section>
      ) : (
        days.map((day) => (
          <section key={day} className="calendar__day">
            <h2 className={`section-title${day === today ? ' calendar__today' : ''}`}>
              {dayLabel(day, today, tomorrow)}
            </h2>
            <ul className="rows">
              {byDay.get(day)!.map((e) => (
                <li key={e.key} className="row">
                  <a href={e.href} className="row__link">
                    <Poster src={e.image} alt={e.title} />
                    <div className="row__body">
                      <h3>{e.title}</h3>
                      <p className="muted row__next">
                        {e.kind === 'movie' && <span aria-hidden="true">🎬 </span>}
                        {e.detail}
                      </p>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}

export function CalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <line x1="3.5" y1="10" x2="20.5" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </svg>
  )
}
