import { useMemo, useState } from 'react'
import { useApp } from '../lib/appState'
import { href } from '../lib/route'
import {
  computeStats, countByStatus, formatNumber, humanBreakdown, humanDuration, monthLabel, shortUnit,
  totalHours, type ShowTotal,
} from '../lib/stats'
import { STATUS_LABEL } from '../lib/store'
import { useShowEpisodes } from '../lib/useShows'

export function Stats() {
  const { tracked, movies, loading, historyFor, fillMovieRuntimes } = useApp()
  const [filling, setFilling] = useState<{ done: number; total: number } | null>(null)
  const ids = useMemo(() => tracked.map((t) => t.show_id), [tracked])
  const { data } = useShowEpisodes(ids)
  const stats = useMemo(
    () => computeStats(tracked, historyFor, data, movies),
    [tracked, historyFor, data, movies],
  )
  const byStatus = useMemo(() => countByStatus(tracked), [tracked])

  if (loading) return <p className="muted pad">Chargement…</p>
  if (!tracked.length && !movies.length) {
    return (
      <section className="empty">
        <h2>Rien à mesurer pour l'instant</h2>
        <p>Coche des épisodes ou importe ton historique, les statistiques suivront.</p>
        <a className="btn btn--primary" href={href.import}>Importer</a>
      </section>
    )
  }

  const total = totalHours(stats.minutes)
  const series = totalHours(stats.showMinutes)
  const films = totalHours(stats.movieMinutes)
  const breakdown = humanBreakdown(stats.minutes)

  return (
    <div className="stats">
      <h2 className="section-title">Statistiques</h2>

      {stats.pending > 0 && (
        <p className="muted">
          {stats.pending} série{stats.pending > 1 ? 's' : ''} encore en cours de chargement —
          les totaux vont continuer de monter.
        </p>
      )}

      <section className="hero">
        <p className="hero__value">{total.value}</p>
        <p className="hero__unit">{total.unit} de visionnage</p>
        <p className="muted hero__breakdown">soit {breakdown}</p>
        <p className="muted hero__note">
          {formatNumber(stats.episodesWithRewatches)} épisode
          {stats.episodesWithRewatches > 1 ? 's' : ''} et {formatNumber(stats.movies)} film
          {stats.movies > 1 ? 's' : ''}
          {stats.firstWatch && ` depuis ${monthLabel(stats.firstWatch.slice(0, 7))}`}
          {stats.episodesWithRewatches > stats.episodes &&
            ` — ${formatNumber(stats.episodes)} épisodes distincts, le reste en revisionnages`}
          .
        </p>
        <ul className="split">
          <li>
            <span className="split__value">{series.value} <small>{series.unit}</small></span>
            <span className="split__label">de séries</span>
          </li>
          <li>
            <span className="split__value">{films.value} <small>{films.unit}</small></span>
            <span className="split__label">de films</span>
          </li>
        </ul>
      </section>

      {stats.moviesNoRuntime > 0 && (
        <p className="muted stats__fill">
          {formatNumber(stats.moviesNoRuntime)} film{stats.moviesNoRuntime > 1 ? 's' : ''} sans
          durée connue, non compté{stats.moviesNoRuntime > 1 ? 's' : ''} dans le total.{' '}
          <button
            className="link-btn"
            disabled={filling !== null}
            onClick={async () => {
              setFilling({ done: 0, total: stats.moviesNoRuntime })
              await fillMovieRuntimes((done, total) => setFilling({ done, total }))
              setFilling(null)
            }}
          >
            {filling ? `Relevé… ${filling.done} / ${filling.total}` : 'Relever les durées chez TMDB'}
          </button>
        </p>
      )}

      <ul className="tiles-stat">
        <Tile label="Séries suivies" value={formatNumber(stats.shows)} />
        <Tile label="Séries terminées" value={formatNumber(stats.finished)} />
        <Tile label="Films vus" value={formatNumber(stats.movies)} />
        <Tile label="Séries revues" value={formatNumber(stats.rewatchedShows)} />
      </ul>

      <TopShows shows={stats.topShows} />

      <p className="muted stats__caveat">
        Les durées viennent de TVmaze ; un épisode sans durée renseignée prend la durée médiane
        de sa série.
        {stats.undatedRuntime > 0 &&
          ` ${formatNumber(stats.undatedRuntime)} épisode(s) sans durée connue sont comptés mais pas chronométrés.`}
        {' '}La durée des films vient de TMDB, relevée film par film à l'ajout.
        {' '}Répartition des séries : {STATUS_LABEL.watching.toLowerCase()} {byStatus.watching},{' '}
        {STATUS_LABEL.paused.toLowerCase()} {byStatus.paused}, {STATUS_LABEL.later.toLowerCase()}{' '}
        {byStatus.later}, {STATUS_LABEL.dropped.toLowerCase()} {byStatus.dropped}.
      </p>
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <li className="tile-stat">
      <p className="tile-stat__label">{label}</p>
      <p className="tile-stat__value">{value}</p>
    </li>
  )
}

/* ------------------------------------------------------------ top séries --- */

function TopShows({ shows }: { shows: ShowTotal[] }) {
  const [table, setTable] = useState(false)
  if (!shows.length) return null
  const peak = shows[0].minutes || 1

  return (
    <section className="chart">
      <div className="chart__head">
        <h3 className="chart__title">Tes séries les plus regardées</h3>
        <button className="link-btn" onClick={() => setTable((v) => !v)}>
          {table ? 'Voir le graphique' : 'Voir le tableau'}
        </button>
      </div>

      {table ? (
        <table className="data-table">
          <thead>
            <tr><th>Série</th><th>Heures</th><th>Épisodes</th><th>Fois vue</th></tr>
          </thead>
          <tbody>
            {shows.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{formatNumber(Math.round(s.minutes / 60))}</td>
                <td>{formatNumber(s.episodes)}</td>
                <td>{formatNumber(s.rewatches + 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="hbars">
          {shows.map((s) => {
            const d = humanDuration(s.minutes)
            return (
              <li key={s.id} className="hbars__row">
                <a className="hbars__name" href={href.show(s.id)} title={s.name}>{s.name}</a>
                <span className="hbars__track">
                  <span className="hbars__bar" style={{ width: `${(s.minutes / peak) * 100}%` }} />
                </span>
                <span className="hbars__value">
                  {d.value} {shortUnit(d.unit)}
                  {s.rewatches > 0 && <span className="hbars__times"> ×{s.rewatches + 1}</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
