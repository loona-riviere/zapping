import { useMemo, useState } from 'react'
import { useApp } from '../lib/appState'
import { useBooks } from '../lib/booksState'
import { buildBackup, downloadBackup } from '../lib/backup'
import { findActivityIssues, findSeasonIssues, type ActivityIssue, type SeasonIssue } from '../lib/diagnostics'
import { formatShortDate } from '../lib/progress'
import { href } from '../lib/route'
import {
  computeReadingStats, computeStats, computeTimeline, countByStatus, formatNumber, humanBreakdown, humanDuration, monthLabel,
  shortUnit, totalHours, type ReadingStats, type ShowTotal, type TimeBucket,
} from '../lib/stats'
import { STATUS_LABEL } from '../lib/store'
import { useShowEpisodes } from '../lib/useShows'

export function Stats() {
  const { tracked, movies, loading, historyFor, watchedFor, isRewatching, fillMovieRuntimes, fixActivity } = useApp()
  const { books } = useBooks()
  const reading = useMemo(() => computeReadingStats(books), [books])
  const [filling, setFilling] = useState<{ done: number; total: number } | null>(null)
  const ids = useMemo(() => tracked.map((t) => t.show_id), [tracked])
  const { data } = useShowEpisodes(ids)
  const stats = useMemo(
    () => computeStats(tracked, historyFor, data, movies),
    [tracked, historyFor, data, movies],
  )
  const byStatus = useMemo(() => countByStatus(tracked), [tracked])
  const timeline = useMemo(
    () => computeTimeline(tracked, historyFor, data, movies),
    [tracked, historyFor, data, movies],
  )
  const [report, setReport] = useState<{ activity: ActivityIssue[]; season: SeasonIssue[] } | null>(null)
  const [fixingAll, setFixingAll] = useState(false)

  if (loading) return <p className="muted pad">Chargement…</p>
  if (!tracked.length && !movies.length && !books.length) {
    return (
      <section className="empty">
        <h2>Rien à mesurer pour l'instant</h2>
        <p>Coche des épisodes, ajoute un livre ou importe ton historique, les statistiques suivront.</p>
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

      {(tracked.length > 0 || movies.length > 0) && (
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
      )}

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

      <Timeline months={timeline.months} years={timeline.years} />

      {books.length > 0 && <Reading stats={reading} />}

      <section className="diag">
        <div className="diag__head">
          <h3 className="chart__title">Vérifier les incohérences</h3>
          <button
            className="link-btn"
            onClick={() => {
              const activity = findActivityIssues(tracked, watchedFor, historyFor)
              const season = findSeasonIssues(tracked, data, historyFor)
              setReport({ activity, season })
            }}
          >
            Lancer la vérification
          </button>
        </div>

        {report && (
          <>
            {report.activity.length === 0 && report.season.length === 0 ? (
              <p className="muted">Rien à signaler : les données sont cohérentes.</p>
            ) : (
              <>
                {report.activity.length > 0 && (
                  <div className="diag__group">
                    <p>
                      {report.activity.length} série{report.activity.length > 1 ? 's' : ''} avec un
                      tri de l'accueil décalé de la vraie dernière activité.{' '}
                      <button
                        className="link-btn"
                        disabled={fixingAll}
                        onClick={async () => {
                          setFixingAll(true)
                          for (const issue of report.activity) await fixActivity(issue.showId, issue.actual)
                          setFixingAll(false)
                          setReport((r) => (r ? { ...r, activity: [] } : r))
                        }}
                      >
                        {fixingAll ? 'Correction…' : 'Tout corriger'}
                      </button>
                    </p>
                    <ul className="diag__list">
                      {report.activity.map((issue) => (
                        <li key={issue.showId}>
                          <a href={href.show(issue.showId)}>{issue.showName}</a> — enregistré{' '}
                          {issue.recorded ? formatShortDate(issue.recorded) : 'jamais'}, en vrai{' '}
                          {issue.actual ? formatShortDate(issue.actual) : 'jamais'}.{' '}
                          <button
                            className="link-btn"
                            onClick={async () => {
                              await fixActivity(issue.showId, issue.actual)
                              setReport((r) =>
                                r ? { ...r, activity: r.activity.filter((i) => i.showId !== issue.showId) } : r,
                              )
                            }}
                          >
                            Corriger
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {report.season.length > 0 && (
                  <div className="diag__group">
                    <p>
                      {report.season.length} saison{report.season.length > 1 ? 's' : ''} où les dates
                      ne progressent pas dans l'ordre de diffusion — signe possible d'un import mal
                      associé. À revoir au cas par cas, rien n'est corrigé automatiquement.
                    </p>
                    <ul className="diag__list">
                      {report.season.map((issue, i) => (
                        <li key={i}>
                          <a href={href.show(issue.showId)}>{issue.showName}</a>, saison {issue.season} —{' '}
                          {issue.before.code} vu le {formatShortDate(issue.before.date)}, après{' '}
                          {issue.after.code} vu le {formatShortDate(issue.after.date)}.
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </section>

      <section className="diag">
        <div className="diag__head">
          <h3 className="chart__title">Sauvegarde</h3>
          <button
            className="link-btn"
            onClick={() =>
              downloadBackup(buildBackup(tracked, historyFor, watchedFor, isRewatching, data, movies, books))
            }
          >
            Exporter mes données (JSON)
          </button>
        </div>
        <p className="muted">
          Une copie de toutes tes séries suivies, épisodes vus, films et livres, dans un fichier que tu peux
          garder de ton côté.
        </p>
      </section>

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

/* ------------------------------------------------------------------ lecture -- */

function Reading({ stats }: { stats: ReadingStats }) {
  const peak = stats.byYear.reduce((m, y) => Math.max(m, y.books), 0) || 1
  return (
    <section className="chart">
      <div className="chart__head">
        <h3 className="chart__title">Lecture</h3>
      </div>
      <ul className="tiles-stat">
        <Tile label="Livres lus" value={formatNumber(stats.read)} />
        <Tile label="Pages lues" value={formatNumber(stats.pages)} />
        <Tile label="En cours" value={formatNumber(stats.reading)} />
        <Tile label="À lire" value={formatNumber(stats.toRead)} />
      </ul>
      {stats.byYear.length > 0 && (
        <ul className="hbars" style={{ marginTop: '1rem' }}>
          {stats.byYear.map((y) => (
            <li key={y.year} className="hbars__row">
              <span className="hbars__name">{y.year}</span>
              <span className="hbars__track">
                <span className="hbars__bar" style={{ width: `${(y.books / peak) * 100}%` }} />
              </span>
              <span className="hbars__value">
                {formatNumber(y.books)} livre{y.books > 1 ? 's' : ''}
                {y.pages > 0 && <span className="muted"> · {formatNumber(y.pages)} p.</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {stats.readNoPages > 0 && (
        <p className="muted" style={{ fontSize: '.85rem' }}>
          {formatNumber(stats.readNoPages)} livre{stats.readNoPages > 1 ? 's' : ''} lu
          {stats.readNoPages > 1 ? 's' : ''} sans nombre de pages connu : ouvre sa fiche pour le préciser.
        </p>
      )}
    </section>
  )
}

/* ------------------------------------------------------------ mois / année -- */

const RECENT_MONTHS = 12

function Timeline({ months, years }: { months: TimeBucket[]; years: TimeBucket[] }) {
  const [unit, setUnit] = useState<'month' | 'year'>('year')
  if (!months.length) return null

  const buckets = unit === 'year' ? years : months.slice(0, RECENT_MONTHS)
  const peak = buckets.reduce((m, b) => Math.max(m, b.minutes), 0) || 1

  return (
    <section className="chart">
      <div className="chart__head">
        <h3 className="chart__title">Par mois et par année</h3>
      </div>
      <div className="subtabs" role="tablist">
        <button role="tab" aria-selected={unit === 'year'} onClick={() => setUnit('year')}>
          Années
        </button>
        <button role="tab" aria-selected={unit === 'month'} onClick={() => setUnit('month')}>
          Mois
        </button>
      </div>
      {unit === 'month' && months.length > RECENT_MONTHS && (
        <p className="muted" style={{ fontSize: '.85rem', marginTop: '-.25rem' }}>
          Les {RECENT_MONTHS} derniers mois avec au moins un visionnage.
        </p>
      )}
      <ul className="hbars">
        {buckets.map((b) => {
          const d = humanDuration(b.minutes)
          const count = b.episodes + b.movies
          return (
            <li key={b.key} className="hbars__row">
              <span className="hbars__name">{unit === 'year' ? b.key : monthLabel(b.key)}</span>
              <span className="hbars__track">
                <span className="hbars__bar" style={{ width: `${(b.minutes / peak) * 100}%` }} />
              </span>
              <span className="hbars__value">
                {d.value} {shortUnit(d.unit)}
                <span className="muted"> · {formatNumber(count)}</span>
              </span>
            </li>
          )
        })}
      </ul>
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
