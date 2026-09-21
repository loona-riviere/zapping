import { useEffect, useState } from 'react'
import { useApp } from '../lib/appState'
import { computeProgress, epCode, formatDate, type Progress } from '../lib/progress'
import { href } from '../lib/route'
import { getShowWithEpisodes, type ShowWithEpisodes } from '../lib/tvmaze'
import { Poster } from './Poster'

type Row = { id: number; name: string; image: string | null; sortKey: string; data?: ShowWithEpisodes; progress?: Progress }

export function Home() {
  const { tracked, loading, watchedFor, setWatched } = useApp()
  const [cache, setCache] = useState<Record<number, ShowWithEpisodes>>({})
  const [failed, setFailed] = useState<Set<number>>(new Set())

  // Charge les épisodes de chaque série suivie, 4 à la fois pour ménager TVmaze.
  useEffect(() => {
    let alive = true
    const queue = tracked.map((t) => t.show_id).filter((id) => !cache[id])
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        try {
          const d = await getShowWithEpisodes(id)
          if (alive) setCache((c) => ({ ...c, [id]: d }))
        } catch {
          if (alive) setFailed((f) => new Set(f).add(id))
        }
      }
    }
    Promise.all([worker(), worker(), worker(), worker()])
    return () => {
      alive = false
    }
  }, [tracked])

  if (loading) return <p className="muted pad">Chargement de tes séries…</p>

  if (!tracked.length) {
    return (
      <section className="empty">
        <h2>Aucune série suivie</h2>
        <p>Cherche une série pour l'ajouter, puis coche les épisodes au fur et à mesure.</p>
        <a className="btn btn--primary" href={href.search}>Chercher une série</a>
      </section>
    )
  }

  const rows: Row[] = tracked.map((t) => {
    const data = cache[t.show_id]
    return {
      id: t.show_id,
      name: data?.show.name ?? t.name,
      image: data?.show.image?.medium ?? t.image_url,
      sortKey: t.last_watched_at ?? t.added_at,
      data,
      progress: data ? computeProgress(data.episodes, watchedFor(t.show_id)) : undefined,
    }
  })
  rows.sort((a, b) => b.sortKey.localeCompare(a.sortKey))

  const toWatch = rows.filter((r) => !r.progress || r.progress.next)
  const upToDate = rows.filter((r) => r.progress && !r.progress.next && r.data!.show.status !== 'Ended')
  const finished = rows.filter((r) => r.progress && !r.progress.next && r.data!.show.status === 'Ended')

  return (
    <div className="home">
      {toWatch.length > 0 && (
        <section>
          <h2 className="section-title">À voir</h2>
          <ul className="rows">
            {toWatch.map((r) => (
              <li key={r.id} className="row">
                <a href={href.show(r.id)} className="row__link">
                  <Poster src={r.image} alt={r.name} />
                  <div className="row__body">
                    <h3>{r.name}</h3>
                    {r.progress?.next ? (
                      <>
                        <p className="row__next">
                          <strong>{epCode(r.progress.next)}</strong> {r.progress.next.name}
                        </p>
                        <ProgressBar p={r.progress} />
                      </>
                    ) : (
                      <p className="muted">{failed.has(r.id) ? 'Épisodes indisponibles pour le moment' : 'Chargement…'}</p>
                    )}
                  </div>
                </a>
                {r.progress?.next && r.data && (
                  <button
                    className="btn btn--seen"
                    onClick={() => setWatched(r.data!.show, [r.progress!.next!], true)}
                    aria-label={`Marquer ${epCode(r.progress.next)} de ${r.name} comme vu`}
                  >
                    Vu
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {upToDate.length > 0 && (
        <section>
          <h2 className="section-title">À jour</h2>
          <ul className="rows">
            {upToDate.map((r) => (
              <li key={r.id} className="row">
                <a href={href.show(r.id)} className="row__link">
                  <Poster src={r.image} alt={r.name} />
                  <div className="row__body">
                    <h3>{r.name}</h3>
                    <p className="muted">
                      {r.progress!.upcoming
                        ? `${epCode(r.progress!.upcoming)} le ${formatDate(r.progress!.upcoming.airstamp ?? r.progress!.upcoming.airdate)}`
                        : 'Pas de nouvel épisode annoncé'}
                    </p>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {finished.length > 0 && (
        <section>
          <h2 className="section-title">Terminées</h2>
          <ul className="shelf">
            {finished.map((r) => (
              <li key={r.id}>
                <a href={href.show(r.id)} title={r.name}>
                  <Poster src={r.image} alt={r.name} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function ProgressBar({ p }: { p: Progress }) {
  const pct = p.aired ? Math.round((p.watched / p.aired) * 100) : 0
  const left = p.aired - p.watched
  return (
    <div className="progress">
      <div className="progress__track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="progress__label">
        {left} {left > 1 ? 'restants' : 'restant'}
      </span>
    </div>
  )
}
