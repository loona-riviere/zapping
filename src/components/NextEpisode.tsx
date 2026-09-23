import { useEffect, useState } from 'react'
import { epCode, formatDate } from '../lib/progress'
import { seasonOverviewsFr } from '../lib/tmdb'
import { stripHtml, type TvEpisode } from '../lib/tvmaze'

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
  next, upcoming, imdbId, onSeen,
}: {
  next: TvEpisode | null
  upcoming: TvEpisode | null
  imdbId: string | null | undefined
  onSeen: (ep: TvEpisode) => void
}) {
  const ep = next ?? upcoming
  const [frSummary, setFrSummary] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setFrSummary(null)
    setExpanded(false)
    if (!ep || !imdbId) return
    let alive = true
    seasonOverviewsFr(imdbId, ep.season)
      .then((eps) => alive && setFrSummary(eps?.get(ep.number) ?? null))
      .catch(() => {
        /* pas de traduction : on garde le résumé anglais de TVmaze */
      })
    return () => {
      alive = false
    }
  }, [ep?.id, imdbId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ep) return null
  const summary = frSummary ?? (ep.summary ? stripHtml(ep.summary) : '')
  const long = summary.length > LONG

  return (
    <section className="next-ep" aria-label="Prochain épisode">
      <p className="next-ep__label muted">{next ? 'Prochain épisode' : 'Prochain à sortir'}</p>
      <div className="next-ep__head">
        <h2 className="next-ep__title">
          <span className="next-ep__code">{epCode(ep)}</span> {ep.name}
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
