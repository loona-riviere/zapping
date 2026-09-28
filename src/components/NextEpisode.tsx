import { useEffect, useState } from 'react'
import { epCode, formatDate } from '../lib/progress'
import { href } from '../lib/route'
import { stripHtml, type TvEpisode } from '../lib/series'

// Au-delà, le résumé est replié sur deux lignes : on voit de quoi parle
// l'épisode sans tout lire (et sans se spoiler) par accident.
const LONG = 120

/**
 * Le prochain épisode à voir, en tête de fiche : titre, date, résumé (en
 * français quand TMDB l'a) et un bouton pour le cocher sans chercher sa case
 * dans la grille. Coché, le bloc passe tout seul au suivant. À jour, il
 * annonce le prochain à sortir.
 */
export function NextEpisode({
  showId, next, upcoming, onSeen,
}: {
  showId: number
  next: TvEpisode | null
  upcoming: TvEpisode | null
  onSeen: (ep: TvEpisode) => void
}) {
  const ep = next ?? upcoming
  const [expanded, setExpanded] = useState(false)

  useEffect(() => setExpanded(false), [ep?.id])

  if (!ep) return null
  const summary = ep.summary ? stripHtml(ep.summary) : ''
  const long = summary.length > LONG

  return (
    <section className="next-ep" aria-label="Prochain épisode">
      <p className="next-ep__label muted">{next ? 'Prochain épisode' : 'Prochain à sortir'}</p>
      <div className="next-ep__head">
        <h2 className="next-ep__title">
          <a href={href.episode(showId, ep.id)} className="next-ep__link">
            <span className="next-ep__code">{epCode(ep)}</span> {ep.name} <span className="muted" aria-hidden="true">›</span>
          </a>
        </h2>
        {next && (
          <button type="button" className="btn btn--seen" onClick={() => onSeen(ep)}>
            Vu
          </button>
        )}
      </div>
      {!next && ep.airdate && <p className="muted next-ep__date">Le {formatDate(ep.airstamp ?? ep.airdate)}</p>}
      {summary && (
        <>
          <p className={`next-ep__summary${long && !expanded ? ' next-ep__summary--clamped' : ''}`}>{summary}</p>
          {long && (
            <button type="button" className="link-btn next-ep__more" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Réduire' : 'Lire la suite'}
            </button>
          )}
        </>
      )}
    </section>
  )
}
