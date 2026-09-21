import { useState } from 'react'
import { useApp } from '../lib/appState'
import { formatShortDate } from '../lib/progress'
import { href } from '../lib/route'
import {
  lastDate, parseNetflixCsv, resolveGroup,
  type NetflixGroup, type Resolution,
} from '../lib/netflix'
import { explainMiss, findMovie, findShow } from '../lib/lookup'
import { tmdbConfigured, type Movie } from '../lib/tmdb'
import type { TvEpisode, TvShow } from '../lib/tvmaze'
import { FixMatch, type FixPick } from './FixMatch'
import { Poster } from './Poster'

// TVmaze tolère ~20 requêtes / 10 s et chaque série en consomme deux
// (recherche puis fiche). TMDB est bien plus souple.
const TV_DELAY = 700
const MOVIE_DELAY = 120
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Item = {
  group: NetflixGroup
  kind: 'show' | 'movie'
  state: 'ok' | 'notfound' | 'error' | 'nokey'
  include: boolean
  message?: string
  show?: TvShow
  picks?: Resolution
  movie?: Movie
  /** Titre original par lequel la série a été retrouvée, si différent. */
  via?: string
  /** Titres essayés en vain, pour expliquer un échec. */
  tried?: string[]
}

type Phase = 'pick' | 'resolving' | 'review' | 'saving' | 'done'

export function ImportNetflix() {
  const { setWatched, addMovies } = useApp()
  const [items, setItems] = useState<Item[] | null>(null)
  const [phase, setPhase] = useState<Phase>('pick')
  const [fileName, setFileName] = useState('')
  const [stats, setStats] = useState({ lines: 0, skipped: 0 })
  const [done, setDone] = useState(0)
  const [saved, setSaved] = useState({ shows: 0, episodes: 0, movies: 0 })
  const [error, setError] = useState<string | null>(null)
  // Les reprises antérieures ont pu horodater à la date du jour ; ce CSV porte
  // les vraies dates, encore faut-il autoriser l'écrasement.
  const [fixDates, setFixDates] = useState(false)
  // Ligne pour laquelle la recherche manuelle est ouverte.
  const [fixing, setFixing] = useState<number | null>(null)

  async function onFile(file: File) {
    setError(null)
    let groups: NetflixGroup[]
    let skipped: number
    try {
      const parsed = parseNetflixCsv(await file.text())
      groups = parsed.groups
      skipped = parsed.skipped
    } catch (e) {
      setError(`Lecture impossible : ${(e as Error).message}`)
      return
    }
    if (!groups.length) {
      setError("Ce fichier ne ressemble pas à un export Netflix (colonnes Title et Date attendues).")
      return
    }
    setFileName(file.name)
    setStats({ lines: groups.reduce((n, g) => n + g.entries.length, 0), skipped })
    await resolveAll(groups)
  }

  async function resolveAll(groups: NetflixGroup[]) {
    setPhase('resolving')
    setDone(0)
    const out: Item[] = []
    for (const group of groups) {
      out.push(await resolveOne(group, group.kind))
      setDone(out.length)
      setItems([...out])
      await sleep(group.kind === 'show' ? TV_DELAY : MOVIE_DELAY)
    }
    setPhase('review')
  }

  /** Bascule une entrée entre film et série, puis la recherche à nouveau. */
  async function swapKind(index: number) {
    const item = items?.[index]
    if (!item) return
    const kind = item.kind === 'show' ? 'movie' : 'show'
    setItems((prev) => prev && prev.map((it, i) => (i === index ? { ...it, state: 'error', message: 'Recherche…' } : it)))
    const next = await resolveOne(item.group, kind)
    setItems((prev) => prev && prev.map((it, i) => (i === index ? next : it)))
  }

  function applyFix(index: number, pick: FixPick) {
    setItems((prev) =>
      prev &&
      prev.map((it, i) => {
        if (i !== index) return it
        if (pick.kind === 'show') {
          return {
            ...it,
            kind: 'show',
            state: 'ok',
            include: true,
            show: pick.data.show,
            picks: resolveGroup(it.group, pick.data.episodes),
            via: undefined,
          }
        }
        return { ...it, kind: 'movie', state: 'ok', include: true, movie: pick.movie, via: undefined }
      }),
    )
    setFixing(null)
  }

  function toggle(index: number) {
    setItems((prev) => prev && prev.map((it, i) => (i === index ? { ...it, include: !it.include } : it)))
  }

  async function save() {
    if (!items) return
    setPhase('saving')
    setDone(0)
    let shows = 0
    let episodes = 0
    let progress = 0

    const keep = items.filter((i) => i.include && i.state === 'ok')
    const movies = keep
      .filter((i) => i.kind === 'movie' && i.movie)
      .map((i) => ({ movie: i.movie!, watchedAt: lastDate(i.group) }))

    for (const item of keep.filter((i) => i.kind === 'show' && i.show)) {
      const picks = item.picks?.picks ?? []
      try {
        if (picks.length) {
          const eps: TvEpisode[] = picks.map((p) => p.episode)
          const dates = new Map(picks.map((p) => [p.episode.id, isoAt(p.date)]))
          await setWatched(item.show!, eps, true, dates, fixDates, true)
          episodes += eps.length
        }
        shows++
      } catch {
        /* le bandeau d'erreur du contexte a déjà prévenu */
      }
      setDone(++progress)
    }

    if (movies.length) await addMovies(movies)
    setSaved({ shows, episodes, movies: movies.length })
    setPhase('done')
  }

  function restart() {
    setItems(null)
    setPhase('pick')
    setFileName('')
    setDone(0)
    setError(null)
  }

  /* ----------------------------------------------------------------- vues -- */

  if (phase === 'done') {
    return (
      <div className="import__done">
        <h3>Import terminé</h3>
        <p>
          {saved.shows} série{plural(saved.shows)} et {saved.episodes} épisode{plural(saved.episodes)} coché
          {plural(saved.episodes)}
          {saved.movies > 0 && `, ${saved.movies} film${plural(saved.movies)}`}.
        </p>
        <div className="import__actions">
          <a className="btn btn--primary" href={href.home}>Voir mes séries</a>
          {saved.movies > 0 && <a className="btn btn--ghost" href={href.movies}>Voir mes films</a>}
          <button className="btn btn--ghost" onClick={restart}>Importer un autre fichier</button>
        </div>
      </div>
    )
  }

  const included = items?.filter((i) => i.include && i.state === 'ok') ?? []
  const totalEpisodes = included.reduce((n, i) => n + (i.picks?.picks.length ?? 0), 0)

  return (
    <div className="import__netflix">
      {phase === 'pick' && (
        <>
          <p className="muted">
            Sur <a href="https://www.netflix.com/viewingactivity" target="_blank" rel="noreferrer">netflix.com/viewingactivity</a>,
            choisis ton profil puis « Télécharger tout » : tu récupères un fichier{' '}
            <code>NetflixViewingHistory.csv</code>. Dépose-le ici.
          </p>
          <label className="import__file">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onFile(f)
              }}
            />
          </label>
          {error && <p className="error">{error}</p>}
          {!tmdbConfigured && (
            <p className="muted">
              Les films seront ignorés : ajoute <code>VITE_TMDB_KEY</code> pour les importer aussi.
            </p>
          )}
        </>
      )}

      {phase === 'resolving' && (
        <p className="muted">
          {fileName} — {stats.lines} ligne{plural(stats.lines)} regroupée{plural(stats.lines)}.
          Recherche du catalogue… {done} / {items?.length ?? '?'}
          {items && done < items.length ? '' : ''}
        </p>
      )}

      {phase === 'saving' && (
        <p className="muted">Enregistrement… {done} / {included.filter((i) => i.kind === 'show').length}</p>
      )}

      {phase === 'review' && items && (
        <>
          <p className="muted">
            {stats.lines} ligne{plural(stats.lines)} lue{plural(stats.lines)}
            {stats.skipped > 0 && `, ${stats.skipped} ignorée${plural(stats.skipped)}`}. Décoche ce que
            tu ne veux pas, puis valide.
          </p>
          <p className="import__legend muted">
            <strong>Par titre</strong> : chaque épisode a été reconnu à son nom.{' '}
            <strong>Estimé</strong> : Netflix donne les titres traduits, on coche donc autant
            d'épisodes que de lignes vues, dans l'ordre de diffusion.
          </p>
        </>
      )}

      {items && phase !== 'pick' && (
        <ul className="rows">
          {items.map((item, i) => (
            <ImportRow
              key={item.group.key}
              item={item}
              index={i}
              phase={phase}
              onToggle={toggle}
              onSwap={swapKind}
              fixing={fixing === i}
              onFixOpen={() => setFixing(i)}
              onFixCancel={() => setFixing(null)}
              onFixPick={(pick) => applyFix(i, pick)}
            />
          ))}
        </ul>
      )}

      {phase === 'review' && (
        <label className="import__toggle">
          <input type="checkbox" checked={fixDates} onChange={(e) => setFixDates(e.target.checked)} />
          <span>
            Corriger les dates déjà enregistrées
            <span className="muted">
              {' '}— à cocher si une reprise précédente a daté des épisodes à la date du jour.
              Sans ça, les épisodes déjà cochés gardent leur date actuelle.
            </span>
          </span>
        </label>
      )}

      {phase === 'review' && (
        <div className="import__actions import__actions--sticky">
          <button className="btn btn--primary" disabled={!included.length} onClick={save}>
            Valider — {included.length} œuvre{plural(included.length)}, {totalEpisodes} épisode{plural(totalEpisodes)}
          </button>
          <button className="btn btn--ghost" onClick={restart}>Annuler</button>
        </div>
      )}
    </div>
  )
}

function ImportRow({
  item, index, phase, onToggle, onSwap, fixing, onFixOpen, onFixCancel, onFixPick,
}: {
  item: Item
  index: number
  phase: Phase
  onToggle: (i: number) => void
  onSwap: (i: number) => void
  fixing: boolean
  onFixOpen: () => void
  onFixCancel: () => void
  onFixPick: (pick: FixPick) => void
}) {
  const { group } = item
  const lines = group.entries.length
  const editable = phase === 'review'

  if (item.state !== 'ok') {
    return (
      <li className="row row--stack">
        <div className="row__head">
          <div className="row__body">
            <h3>{group.title}</h3>
            <p className="error">
              {item.state === 'notfound'
                ? explainMiss(item.tried ?? [], item.kind)
                : item.state === 'nokey'
                  ? "Film ignoré : pas de clé TMDB configurée."
                  : item.message}
            </p>
          </div>
          {editable && item.state !== 'nokey' && !fixing && (
            <div className="row__fixactions">
              <button className="link-btn" onClick={() => onSwap(index)}>
                Chercher comme {item.kind === 'movie' ? 'série' : 'film'}
              </button>
              <button className="link-btn" onClick={onFixOpen}>Corriger</button>
            </div>
          )}
        </div>
        {editable && fixing && (
          <FixMatch kind={item.kind} initialQuery={group.title} onPick={onFixPick} onCancel={onFixCancel} />
        )}
      </li>
    )
  }

  const title = item.kind === 'movie' ? item.movie!.title : item.show!.name
  const poster = item.kind === 'movie' ? item.movie!.poster_url : item.show!.image?.medium ?? null
  const when = formatShortDate(lastDate(group))

  return (
    <li className="row">
      <input
        type="checkbox"
        checked={item.include}
        disabled={!editable}
        onChange={() => onToggle(index)}
        aria-label={`Importer ${title}`}
      />
      <div className="row__link">
        <Poster src={poster} alt={title} />
        <div className="row__body">
          <h3>{title}</h3>
          {item.kind === 'movie' ? (
            <p className="muted">
              Film — vu le {when}
              {item.via && <span className="row__via">trouvé sous « {item.via} »</span>}
            </p>
          ) : (
            <p className="muted">
              {item.picks!.picks.length} épisode{plural(item.picks!.picks.length)} sur {lines} ligne
              {plural(lines)}{' '}
              <span className={`tag tag--${item.picks!.mode}`}>
                {item.picks!.mode === 'exact' ? 'par titre' : 'estimé'}
              </span>
              {' '}— dernier visionnage le {when}
              {item.via && <span className="row__via">trouvée sous « {item.via} »</span>}
            </p>
          )}
        </div>
      </div>
      {editable && (
        <button className="link-btn muted" onClick={() => onSwap(index)}>
          {item.kind === 'movie' ? 'Série ?' : 'Film ?'}
        </button>
      )}
    </li>
  )
}

/* ------------------------------------------------------------------ outils -- */

const plural = (n: number) => (n > 1 ? 's' : '')

/** Netflix ne donne qu'un jour : on horodate à midi pour éviter les sauts de fuseau. */
const isoAt = (day: string) => `${day}T12:00:00.000Z`

async function resolveOne(group: NetflixGroup, kind: 'show' | 'movie'): Promise<Item> {
  const base = { group, kind, include: false } as const
  try {
    if (kind === 'movie') {
      if (!tmdbConfigured) return { ...base, state: 'nokey' }
      const found = await findMovie(group.title)
      if (!found) return { ...base, state: 'notfound', tried: [] }
      return { ...base, state: 'ok', include: true, movie: found.movie, via: found.via }
    }
    // Le nombre de lignes distinctes borne par le bas la taille attendue de la
    // série : de quoi écarter un homonyme trop court.
    const { show, tried } = await findShow(group.title, { minEpisodes: group.entries.length })
    if (!show) return { ...base, state: 'notfound', tried }
    return {
      ...base,
      state: 'ok',
      include: true,
      show: show.show,
      via: show.via,
      picks: resolveGroup(group, show.episodes),
    }
  } catch (e) {
    return { ...base, state: 'error', message: `Erreur : ${(e as Error).message}` }
  }
}
