import { useMemo, useState, type ReactNode } from 'react'
import { useApp } from '../lib/appState'
import { useBooks } from '../lib/booksState'
import { usePrefs } from '../lib/prefs'
import { buildBackup, downloadBackup } from '../lib/backup'
import { findActivityIssues, findSeasonIssues, type ActivityIssue, type SeasonIssue } from '../lib/diagnostics'
import { formatShortDate } from '../lib/progress'
import { href } from '../lib/route'
import {
  computeBookTimeline, computeReadingStats, computeStats, computeTimeline, countByStatus, formatNumber, humanBreakdown, humanDuration, monthLabel,
  shortUnit, totalHours, type ReadingStats, type ShowTotal,
} from '../lib/stats'
import { STATUS_LABEL } from '../lib/store'
import { useShowEpisodes } from '../lib/useShows'

export function Stats() {
  const app = useApp()
  const { loading, historyFor, watchedFor, isRewatching, fillMovieRuntimes, fixActivity } = app
  const { has } = usePrefs()
  const booksState = useBooks()
  // Un type décoché dans les paramètres sort des statistiques, comme de la
  // bibliothèque : ses chiffres ne comptent plus nulle part.
  const tracked = useMemo(() => (has('show') ? app.tracked : []), [has, app.tracked])
  const movies = useMemo(() => (has('movie') ? app.movies : []), [has, app.movies])
  const books = useMemo(() => (has('book') ? booksState.books : []), [has, booksState.books])
  const reading = useMemo(() => computeReadingStats(books), [books])
  const [filling, setFilling] = useState<{ done: number; total: number } | null>(null)
  const ids = useMemo(() => tracked.map((t) => t.show_id), [tracked])
  const { data } = useShowEpisodes(ids)
  const stats = useMemo(
    () => computeStats(tracked, historyFor, data, movies),
    [tracked, historyFor, data, movies],
  )
  const byStatus = useMemo(() => countByStatus(tracked), [tracked])
  // Un graphique par type : additionner des heures de séries, de films et
  // des pages de livres dans une même barre ne voudrait rien dire.
  const showTimeline = useMemo(() => computeTimeline(tracked, historyFor, data, []), [tracked, historyFor, data])
  const movieTimeline = useMemo(() => computeTimeline([], historyFor, {}, movies), [historyFor, movies])
  const bookTimeline = useMemo(() => computeBookTimeline(books), [books])
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
        {has('show') && has('movie') && (
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
        )}
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

      {(has('show') || has('movie')) && (
        <ul className="tiles-stat">
          {has('show') && <Tile label="Séries suivies" value={formatNumber(stats.shows)} />}
          {has('show') && <Tile label="Séries terminées" value={formatNumber(stats.finished)} />}
          {has('movie') && <Tile label="Films vus" value={formatNumber(stats.movies)} />}
          {has('show') && <Tile label="Séries revues" value={formatNumber(stats.rewatchedShows)} />}
        </ul>
      )}

      <TopShows shows={stats.topShows} />

      {has('show') && (
        <Timeline
          title="Séries par année"
          months={showTimeline.months}
          years={showTimeline.years}
          measure={(b) => b.minutes}
          label={(b) => {
            const d = humanDuration(b.minutes)
            return <>{d.value} {shortUnit(d.unit)}<span className="muted"> · {formatNumber(b.episodes)} ép.</span></>
          }}
        />
      )}
      {has('movie') && (
        <Timeline
          title="Films par année"
          months={movieTimeline.months}
          years={movieTimeline.years}
          measure={(b) => b.movies}
          label={(b) => {
            const d = humanDuration(b.minutes)
            return <>{formatNumber(b.movies)} film{b.movies > 1 ? 's' : ''}{b.minutes > 0 && <span className="muted"> · {d.value} {shortUnit(d.unit)}</span>}</>
          }}
        />
      )}

      {books.length > 0 && <Reading stats={reading} />}
      {books.length > 0 && (
        <Timeline
          title="Livres par année"
          months={bookTimeline.months}
          years={bookTimeline.years}
          measure={(b) => b.books}
          label={(b) => <>{formatNumber(b.books)} livre{b.books > 1 ? 's' : ''}{b.pages > 0 && <span className="muted"> · {formatNumber(b.pages)} p.</span>}</>}
        />
      )}

      {has('show') && (
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
      )}

      <section className="diag">
        <div className="diag__head">
          <h3 className="chart__title">Sauvegarde</h3>
          <button
            className="link-btn"
            onClick={() =>
              downloadBackup(buildBackup(app.tracked, historyFor, watchedFor, isRewatching, data, app.movies, booksState.books))
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

      {(has('show') || has('movie')) && (
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
      )}
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

function Timeline<B extends { key: string }>({
  title, months, years, measure, label,
}: {
  title: string
  months: B[]
  years: B[]
  /** Longueur de la barre : minutes, nombre de films, de livres… */
  measure: (b: B) => number
  label: (b: B) => ReactNode
}) {
  const [unit, setUnit] = useState<'month' | 'year'>('year')
  if (!months.length) return null

  const buckets = unit === 'year' ? years : months.slice(0, RECENT_MONTHS)
  const peak = buckets.reduce((m, b) => Math.max(m, measure(b)), 0) || 1

  return (
    <section className="chart">
      <div className="chart__head">
        <h3 className="chart__title">{title}</h3>
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
          Les {RECENT_MONTHS} derniers mois avec de l'activité.
        </p>
      )}
      <ul className="hbars">
        {buckets.map((b) => (
          <li key={b.key} className="hbars__row">
            <span className="hbars__name">{unit === 'year' ? b.key : monthLabel(b.key)}</span>
            <span className="hbars__track">
              <span className="hbars__bar" style={{ width: `${(measure(b) / peak) * 100}%` }} />
            </span>
            <span className="hbars__value">{label(b)}</span>
          </li>
        ))}
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
