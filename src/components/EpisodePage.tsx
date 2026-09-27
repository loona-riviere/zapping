import { useEffect, useRef, useState } from 'react'
import { useApp } from '../lib/appState'
import { epCode, formatDate, formatShortDate, isAired } from '../lib/progress'
import { href } from '../lib/route'
import { seasonEpisodesFr, type EpisodeFr } from '../lib/tmdb'
import { getShowWithEpisodes, stripHtml, type ShowWithEpisodes } from '../lib/tvmaze'
import { DateField } from './History'
import { Comments } from './Comments'

/**
 * La page d'un épisode, en plein écran : image, titre et résumé (en français
 * quand TMDB les a), diffusion, et « Vu » avec sa date. Les flèches — ou un
 * glissé horizontal sur l'image — passent au précédent / suivant, pour
 * enchaîner comme dans une appli de streaming.
 */
export function EpisodePage({ showId, episodeId }: { showId: number; episodeId: number }) {
  const { watchedFor, historyFor, setWatched, isTracked, track, tracked } = useApp()
  const [data, setData] = useState<ShowWithEpisodes | null>(null)
  const [error, setError] = useState(false)
  const [fr, setFr] = useState<Map<number, EpisodeFr> | null>(null)
  const swipe = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    getShowWithEpisodes(showId)
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [showId])

  const ep = data?.episodes.find((e) => e.id === episodeId)
  const imdb = data?.show.externals?.imdb
  useEffect(() => {
    if (!imdb || !ep) return
    let alive = true
    setFr(null)
    seasonEpisodesFr(imdb, ep.season)
      .then((m) => alive && setFr(m))
      .catch(() => {
        /* pas de traduction : on garde TVmaze */
      })
    return () => {
      alive = false
    }
  }, [imdb, ep?.season])

  if (error) return <p className="error pad">Impossible de charger cet épisode. <a href={href.show(showId)}>Retour</a></p>
  if (!data) return <p className="muted pad">Chargement…</p>
  if (!ep) return <p className="error pad">Épisode introuvable. <a href={href.show(showId)}>Retour à la série</a></p>

  const { show, episodes } = data
  const idx = episodes.findIndex((e) => e.id === ep.id)
  const prev = episodes[idx - 1]
  const next = episodes[idx + 1]
  const watched = watchedFor(showId)
  const history = historyFor(showId)
  const seen = watched.has(ep.id)
  const seenAt = watched.get(ep.id) ?? null
  const aired = isAired(ep)
  const t = fr?.get(ep.number)
  const title = t?.name ?? ep.name
  const summary = t?.overview ?? stripHtml(ep.summary)
  const image = t?.still ?? ep.image?.original ?? null
  const showName = tracked.find((x) => x.show_id === showId)?.name ?? show.name
  const go = (id: number) => (window.location.hash = href.episode(showId, id))

  async function markSeen() {
    if (!isTracked(showId)) await track(show)
    setWatched(show, [ep!], true)
  }

  return (
    <article className="episode">
      <a className="episode__back" href={href.show(showId)}>‹ {showName}</a>

      <div
        className={`episode__hero${image ? '' : ' episode__hero--empty'}`}
        onPointerDown={(e) => (swipe.current = e.clientX)}
        onPointerUp={(e) => {
          if (swipe.current === null) return
          const dx = e.clientX - swipe.current
          swipe.current = null
          if (dx < -60 && next) go(next.id)
          else if (dx > 60 && prev) go(prev.id)
        }}
      >
        {image ? <img src={image} alt="" /> : <span>{epCode(ep)}</span>}
      </div>

      <p className="episode__code">
        Saison {ep.season} · Épisode {ep.number}
      </p>
      <h1 className="episode__title">{title}</h1>
      <p className="muted episode__meta">
        {[ep.airdate ? (aired ? `Diffusé le ${formatDate(ep.airstamp ?? ep.airdate)}` : `Sort le ${formatDate(ep.airstamp ?? ep.airdate)}`) : null, ep.runtime ? `${ep.runtime} min` : null]
          .filter(Boolean)
          .join(' · ')}
      </p>

      <div className="episode__actions">
        {seen ? (
          <>
            <button
              className="btn btn--seen"
              onClick={() => confirm(`Décocher ${epCode(ep)} ? Sa date de visionnage sera perdue.`) && setWatched(show, [ep], false)}
            >
              ✓ Vu
            </button>
            <DateField
              label="le"
              value={seenAt}
              onChange={(v) => setWatched(show, [ep], true, new Map([[ep.id, v]]), true, false)}
            />
          </>
        ) : (
          <button className="btn btn--primary" disabled={!aired} onClick={markSeen}>
            {aired ? 'Marquer vu' : 'Pas encore sorti'}
          </button>
        )}
      </div>

      {summary ? <p className="episode__summary">{summary}</p> : <p className="muted">Pas de résumé pour cet épisode.</p>}

      <nav className="episode__nav" aria-label="Autres épisodes">
        {prev ? (
          <a href={href.episode(showId, prev.id)} className="episode__step">
            <span className="muted">‹ Précédent</span>
            <span>{epCode(prev)}</span>
          </a>
        ) : (
          <span />
        )}
        {next ? (
          <a href={href.episode(showId, next.id)} className="episode__step episode__step--next">
            <span className="muted">Suivant ›</span>
            <span>{epCode(next)}{watched.has(next.id) ? ' ✓' : ''}</span>
          </a>
        ) : (
          <span />
        )}
      </nav>
      {seen && seenAt && <p className="muted episode__foot">Vu le {formatShortDate(seenAt)}</p>}

      <Comments kind="episode" itemId={String(ep.id)} showId={showId} title={`${showName} ${epCode(ep)}`} seen={seen || !!history?.has(ep.id)} />
    </article>
  )
}
