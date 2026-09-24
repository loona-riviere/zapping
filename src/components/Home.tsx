import { useMemo, useState } from 'react'
import { useApp } from '../lib/appState'
import { computeProgress, epCode, formatDate, type Progress } from '../lib/progress'
import { href } from '../lib/route'
import { STATUS_LABEL, type ShowStatus } from '../lib/store'
import type { ShowWithEpisodes } from '../lib/tvmaze'
import { useShowEpisodes } from '../lib/useShows'
import { Poster } from './Poster'
import { StatusPicker } from './StatusPicker'
import { SwipeRow } from './SwipeRow'

type Row = {
  id: number
  name: string
  image: string | null
  /** Date du dernier épisode réellement coché ; absente si rien n'a jamais été vu. */
  lastWatchedAt: string | null
  addedAt: string
  status: ShowStatus
  data?: ShowWithEpisodes
  progress?: Progress
}

/**
 * Une série ajoutée à l'instant n'a rien de « récemment regardée » : sans
 * ce garde-fou, la suivre suffit à la faire passer devant une série qu'on a
 * vraiment vue une heure plus tôt (son dernier visionnage réel peut être
 * plus ancien que « maintenant », l'instant de l'ajout).
 */
function byActivity(a: Row, b: Row): number {
  if (a.lastWatchedAt && b.lastWatchedAt) return b.lastWatchedAt.localeCompare(a.lastWatchedAt)
  if (a.lastWatchedAt) return -1
  if (b.lastWatchedAt) return 1
  return b.addedAt.localeCompare(a.addedAt)
}

/** Insensible aux accents et à la casse : « chateau » retrouve « Château ». */
const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function Home() {
  const { tracked, loading, watchedFor, setWatched, setStatus } = useApp()
  // Dernière série abandonnée, pour proposer d'annuler : un abandon se fait
  // d'un geste depuis la liste, autant qu'il se défasse pareil.
  const [undo, setUndo] = useState<{ text: string; revert: () => void } | null>(null)
  const [query, setQuery] = useState('')
  const ids = useMemo(() => tracked.map((t) => t.show_id), [tracked])
  const { data: cache, failed, ready } = useShowEpisodes(ids)

  /** Glisser à gauche : abandonner (s'annule), jamais supprimer — l'historique d'une série ne se reconstruit pas. */
  const dropAction = (r: Row) => ({
    label: 'Abandonner',
    onSwipe: () => {
      const before = r.status
      setStatus(r.id, 'dropped')
      setUndo({ text: `${r.name} — abandonnée.`, revert: () => setStatus(r.id, before) })
    },
  })

  /** Glisser à droite : cocher le prochain épisode, comme le bouton « Vu ». */
  const seenAction = (r: Row) => {
    const next = r.progress?.next
    if (!next || !r.data) return undefined
    const show = r.data.show
    return {
      label: `Vu ${epCode(next)}`,
      onSwipe: () => {
        setWatched(show, [next], true)
        setUndo({ text: `${r.name} — ${epCode(next)} vu.`, revert: () => setWatched(show, [next], false) })
      },
    }
  }

  // Squelette tant que la liste ou le cache des fiches n'est pas là : la
  // bibliothèque apparaît ensuite d'un seul bloc, sans séries qui sautent.
  if (loading || (tracked.length > 0 && !ready)) return <HomeSkeleton />

  if (!tracked.length) {
    return (
      <section className="empty">
        <h2>Aucune série suivie</h2>
        <p>Cherche une série pour l'ajouter, puis coche les épisodes au fur et à mesure.</p>
        <a className="btn btn--primary" href={href.search}>Chercher une série</a>
        <p className="muted empty__alt">
          Tu as un historique Netflix ? <a href={href.import}>Importe-le</a>.
        </p>
      </section>
    )
  }

  const rows: Row[] = tracked.map((t) => {
    const data = cache[t.show_id]
    return {
      id: t.show_id,
      // Le titre suivi fait foi (il porte le français une fois posé par la
      // fiche série) : le nom TVmaze, toujours en anglais, ne sert que tant
      // qu'on n'a encore rien suivi.
      name: t.name,
      image: data?.show.image?.medium ?? t.image_url,
      lastWatchedAt: t.last_watched_at,
      addedAt: t.added_at,
      status: t.status,
      data,
      progress: data ? computeProgress(data.episodes, watchedFor(t.show_id)) : undefined,
    }
  })
  rows.sort(byActivity)

  // Jamais chargée (série tout juste ajoutée, premier lancement) : squelette
  // plutôt qu'une place provisoire dans « À voir » d'où elle sauterait ensuite.
  const pending = rows.filter((r) => r.status === 'watching' && !r.data && !failed.has(r.id))
  const active = rows.filter((r) => r.status === 'watching' && (r.data || failed.has(r.id)))
  const toWatch = active.filter((r) => !r.progress || r.progress.next)
  const upToDateAll = active.filter((r) => r.progress && !r.progress.next && r.data!.show.status !== 'Ended')
  // Une date de retour connue n'a rien à voir avec un renouvellement sans
  // date : la première se planifie, la seconde ne fait qu'attendre.
  const upcoming = upToDateAll
    .filter((r) => airOf(r))
    .sort((a, b) => airOf(a)!.localeCompare(airOf(b)!))
  const noDateYet = upToDateAll.filter((r) => !airOf(r)).sort(byActivity)
  const finished = active.filter((r) => r.progress && !r.progress.next && r.data!.show.status === 'Ended')
  const paused = rows.filter((r) => r.status === 'paused')
  const later = rows.filter((r) => r.status === 'later')
  const dropped = rows.filter((r) => r.status === 'dropped')

  const q = normalize(query.trim())
  const results = q ? rows.filter((r) => normalize(r.name).includes(q)).sort((a, b) => a.name.localeCompare(b.name, 'fr')) : []

  return (
    <div className="home">
      <div className="home__search">
        <label htmlFor="home-q" className="visually-hidden">Chercher dans mes séries</label>
        <input
          id="home-q"
          type="search"
          className="search__input"
          placeholder="Chercher dans mes séries…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {q ? (
        results.length ? (
          <section>
            <h2 className="section-title">
              {results.length} résultat{results.length > 1 ? 's' : ''}
            </h2>
            <Shelf rows={results} withLabel />
          </section>
        ) : (
          <p className="muted pad">
            Aucune série ne correspond à « {query.trim()} ».{' '}
            <a href={href.searchFor(query.trim(), 'show')}>La chercher pour la suivre ?</a>
          </p>
        )
      ) : (
        <>
      {toWatch.length > 0 && (
        <section>
          <h2 className="section-title">À voir</h2>
          <ul className="rows">
            {toWatch.map((r) => (
              <SwipeRow key={r.id} left={dropAction(r)} right={seenAction(r)}>
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
                <div className="row__actions">
                  {r.progress?.next && r.data && (
                    <button
                      className="btn btn--seen"
                      onClick={seenAction(r)!.onSwipe}
                      aria-label={`Marquer ${epCode(r.progress.next)} de ${r.name} comme vu`}
                    >
                      Vu
                    </button>
                  )}
                  <button
                    className="link-btn row__drop"
                    onClick={dropAction(r).onSwipe}
                    aria-label={`Abandonner ${r.name}`}
                  >
                    Abandonner
                  </button>
                </div>
              </SwipeRow>
            ))}
          </ul>
        </section>
      )}

      {pending.length > 0 && (
        <section aria-busy="true">
          <h2 className="section-title muted">
            Chargement de {pending.length} série{pending.length > 1 ? 's' : ''}…
          </h2>
          <SkeletonRows count={Math.min(pending.length, 4)} />
        </section>
      )}

      {upcoming.length > 0 && (
        <section>
          <h2 className="section-title">Bientôt de retour</h2>
          <ul className="rows">
            {upcoming.map((r) => (
              <SwipeRow key={r.id} left={dropAction(r)}>
                <a href={href.show(r.id)} className="row__link">
                  <Poster src={r.image} alt={r.name} />
                  <div className="row__body">
                    <h3>{r.name}</h3>
                    <p className="muted">
                      {epCode(r.progress!.upcoming!)} le {formatDate(r.progress!.upcoming!.airstamp ?? r.progress!.upcoming!.airdate)}
                    </p>
                  </div>
                </a>
              </SwipeRow>
            ))}
          </ul>
        </section>
      )}

      {noDateYet.length > 0 && (
        <section>
          <h2 className="section-title">À jour</h2>
          <ul className="rows">
            {noDateYet.map((r) => (
              <SwipeRow key={r.id} left={dropAction(r)}>
                <a href={href.show(r.id)} className="row__link">
                  <Poster src={r.image} alt={r.name} />
                  <div className="row__body">
                    <h3>{r.name}</h3>
                    <p className="muted">Pas de nouvel épisode annoncé</p>
                  </div>
                </a>
              </SwipeRow>
            ))}
          </ul>
        </section>
      )}

      <Parked title={STATUS_LABEL.paused} rows={paused} left={dropAction} right={seenAction} />
      <Parked title={STATUS_LABEL.later} rows={later} left={dropAction} right={seenAction} />

      {finished.length > 0 && (
        <section>
          <h2 className="section-title">Terminées</h2>
          <Shelf rows={finished} />
        </section>
      )}
        </>
      )}

      {!q && rows.length > 0 && (
        <p className="muted swipe__hint">
          Sur téléphone : glisse vers la droite pour marquer vu le prochain épisode, vers la gauche pour abandonner.
        </p>
      )}

      {undo && (
        <div className="catchup" role="status">
          <p>{undo.text}</p>
          <div className="catchup__actions">
            <button className="btn btn--ghost" onClick={() => setUndo(null)}>Fermer</button>
            <button
              className="btn btn--primary"
              onClick={() => {
                undo.revert()
                setUndo(null)
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {dropped.length > 0 && (
        <section>
          <h2 className="section-title">{STATUS_LABEL.dropped}</h2>
          <Shelf rows={dropped} />
        </section>
      )}
    </div>
  )
}

/** Date de diffusion du prochain épisode annoncé, s'il y en a un. */
function airOf(r: Row): string | null {
  const up = r.progress?.upcoming
  if (!up) return null
  const at = up.airstamp ?? up.airdate
  // TVmaze annonce parfois un épisode « prochain » sans date encore connue
  // (chaîne vide) : ce n'est pas une date invalide à afficher, juste une
  // vraie date manquante — pas de « Bientôt de retour » sans date à montrer.
  return at && !Number.isNaN(new Date(at).getTime()) ? at : null
}

/** Séries mises de côté : on garde le compteur et le bouton de statut à portée. */
type Swipe = { label: string; onSwipe: () => void }

function Parked({
  title, rows, left, right,
}: {
  title: string
  rows: Row[]
  left: (r: Row) => Swipe
  right: (r: Row) => Swipe | undefined
}) {
  if (!rows.length) return null
  return (
    <section>
      <h2 className="section-title">{title}</h2>
      <ul className="rows">
        {rows.map((r) => (
          <SwipeRow key={r.id} left={left(r)} right={right(r)}>
            <a href={href.show(r.id)} className="row__link">
              <Poster src={r.image} alt={r.name} />
              <div className="row__body">
                <h3>{r.name}</h3>
                <p className="muted">
                  {r.progress
                    ? r.progress.next
                      ? `Reprise à ${epCode(r.progress.next)} — ${r.progress.watched}/${r.progress.aired} vus`
                      : `${r.progress.watched}/${r.progress.aired} vus`
                    : <span className="skeleton skeleton--text" />}
                </p>
              </div>
            </a>
            <StatusPicker showId={r.id} />
          </SwipeRow>
        ))}
      </ul>
    </section>
  )
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <ul className="rows" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="row">
          <div className="row__link">
            <span className="skeleton skeleton--poster" />
            <div className="row__body">
              <span className="skeleton skeleton--title" />
              <span className="skeleton skeleton--text" />
              <span className="skeleton skeleton--bar" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function HomeSkeleton() {
  return (
    <div className="home" aria-busy="true" aria-label="Chargement de tes séries">
      <span className="skeleton skeleton--search" />
      <span className="skeleton skeleton--heading" />
      <SkeletonRows count={6} />
    </div>
  )
}

function Shelf({ rows, withLabel }: { rows: Row[]; withLabel?: boolean }) {
  return (
    <ul className="shelf">
      {rows.map((r) => (
        <li key={r.id}>
          <a href={href.show(r.id)} title={r.name}>
            <Poster src={r.image} alt={r.name} />
            {withLabel && <span className="shelf__label">{r.name}</span>}
          </a>
        </li>
      ))}
    </ul>
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
