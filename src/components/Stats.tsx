import { useMemo, useState } from 'react'
import { useApp } from '../lib/appState'
import { href } from '../lib/route'
import {
  computeStats, countByStatus, formatNumber, humanDuration, monthLabel, shortMonth, shortUnit, yearOf,
  type MonthPoint, type ShowTotal,
} from '../lib/stats'
import { STATUS_LABEL } from '../lib/store'
import { useShowEpisodes } from '../lib/useShows'

export function Stats() {
  const { tracked, movies, loading, watchedFor } = useApp()
  const ids = useMemo(() => tracked.map((t) => t.show_id), [tracked])
  const { data } = useShowEpisodes(ids)
  const stats = useMemo(
    () => computeStats(tracked, watchedFor, data, movies),
    [tracked, watchedFor, data, movies],
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

  const total = humanDuration(stats.minutes)

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
        <p className="hero__unit">{total.unit} devant des séries</p>
        <p className="muted hero__note">
          {formatNumber(stats.episodes)} épisode{stats.episodes > 1 ? 's' : ''} vu
          {stats.episodes > 1 ? 's' : ''}
          {stats.firstWatch && ` depuis ${monthLabel(stats.firstWatch.slice(0, 7))}`}.
        </p>
      </section>

      <ul className="tiles-stat">
        <Tile label="Séries suivies" value={formatNumber(stats.shows)} />
        <Tile label="Séries terminées" value={formatNumber(stats.finished)} />
        <Tile label="Films vus" value={formatNumber(stats.movies)} />
        <Tile label="En pause ou abandonnées" value={formatNumber(byStatus.paused + byStatus.dropped)} />
      </ul>

      <MonthlyChart points={stats.byMonth} undated={stats.undated} />
      <TopShows shows={stats.topShows} />

      <p className="muted stats__caveat">
        Les durées viennent de TVmaze ; un épisode sans durée renseignée prend la durée médiane
        de sa série.
        {stats.undatedRuntime > 0 &&
          ` ${formatNumber(stats.undatedRuntime)} épisode(s) sans durée connue sont comptés mais pas chronométrés.`}
        {' '}Les films ne sont pas encore chronométrés : TMDB ne donne pas leur durée dans les
        résultats de recherche.
        {stats.moviesUndated > 0 && ` ${formatNumber(stats.moviesUndated)} film(s) sont sans date de visionnage.`}
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

/* ------------------------------------------------------------- par mois --- */

const MAX_MONTHS = 36

function MonthlyChart({ points, undated }: { points: MonthPoint[]; undated: number }) {
  const [table, setTable] = useState(false)
  const [focus, setFocus] = useState<MonthPoint | null>(null)

  const shown = points.slice(-MAX_MONTHS)
  if (!shown.length) {
    return (
      <section className="chart">
        <h3 className="chart__title">Activité par mois</h3>
        <p className="muted">Aucun épisode daté pour l'instant.</p>
      </section>
    )
  }

  const peak = Math.max(...shown.map((p) => p.minutes), 1)
  const readout = focus ?? shown[shown.length - 1]
  const hours = (m: number) => Math.round(m / 60)

  return (
    <section className="chart">
      <div className="chart__head">
        <h3 className="chart__title">Activité par mois</h3>
        <button className="link-btn" onClick={() => setTable((v) => !v)}>
          {table ? 'Voir le graphique' : 'Voir le tableau'}
        </button>
      </div>

      {table ? (
        <table className="data-table">
          <thead>
            <tr><th>Mois</th><th>Heures</th><th>Épisodes</th></tr>
          </thead>
          <tbody>
            {[...shown].reverse().map((p) => (
              <tr key={p.month}>
                <td>{monthLabel(p.month)}</td>
                <td>{formatNumber(hours(p.minutes))}</td>
                <td>{formatNumber(p.episodes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <p className="chart__readout" aria-live="polite">
            <strong>{monthLabel(readout.month)}</strong> — {formatNumber(hours(readout.minutes))} h,{' '}
            {formatNumber(readout.episodes)} épisode{readout.episodes > 1 ? 's' : ''}
          </p>
          <div className="bars" onMouseLeave={() => setFocus(null)}>
            {shown.map((p, i) => {
              const isJanuary = p.month.endsWith('-01')
              return (
                <button
                  key={p.month}
                  className={`bars__slot${focus?.month === p.month ? ' is-on' : ''}`}
                  style={{ ['--h' as string]: `${(p.minutes / peak) * 100}%` }}
                  onMouseEnter={() => setFocus(p)}
                  onFocus={() => setFocus(p)}
                  onBlur={() => setFocus(null)}
                  aria-label={`${monthLabel(p.month)} : ${hours(p.minutes)} heures, ${p.episodes} épisodes`}
                >
                  <span className="bars__bar" />
                  {(isJanuary || i === 0) && <span className="bars__tick">{isJanuary ? yearOf(p.month) : shortMonth(p.month)}</span>}
                </button>
              )
            })}
          </div>
        </>
      )}

      <p className="muted chart__note">
        {shown.length} derniers mois, en heures.
        {undated > 0 && ` ${formatNumber(undated)} épisode(s) sans date connue n'y figurent pas.`}
      </p>
    </section>
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
            <tr><th>Série</th><th>Heures</th><th>Épisodes</th></tr>
          </thead>
          <tbody>
            {shows.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{formatNumber(Math.round(s.minutes / 60))}</td>
                <td>{formatNumber(s.episodes)}</td>
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
                <span className="hbars__value">{d.value} {shortUnit(d.unit)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
