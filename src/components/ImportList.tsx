import { useState } from 'react'
import { useApp } from '../lib/appState'
import { describeTarget, episodesUpTo, parseList, type ParsedLine } from '../lib/bulk'
import { formatShortDate } from '../lib/progress'
import { href } from '../lib/route'
import { searchMovies, tmdbConfigured, type Movie } from '../lib/tmdb'
import { getShowWithEpisodes, searchShows, type TvEpisode, type TvShow } from '../lib/tvmaze'
import { Poster } from './Poster'

// TVmaze tolère ~20 requêtes / 10 s et chaque ligne en consomme deux
// (recherche puis fiche) : on espace pour ne pas se faire limiter.
const DELAY = 800
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Match = {
  parsed: ParsedLine
  kind: 'show' | 'movie'
  state: 'ok' | 'notfound' | 'error'
  show?: TvShow
  episodes?: TvEpisode[]
  movie?: Movie
  message?: string
  include: boolean
}

const EXAMPLE = `Breaking Bad S05E08
The Office S03
Severance 2x04
The Boys S01E08 @ 12/03/2024
Dark`

const today = () => new Date().toISOString().slice(0, 10)

/** Un jour seul : on horodate à midi pour éviter les sauts de fuseau. */
const isoAt = (day: string) => `${day}T12:00:00.000Z`

/**
 * Une ligne sans saison et introuvable sur TVmaze est probablement un film :
 * on retente sur TMDB avant d'abandonner.
 */
async function resolveLine(parsed: ParsedLine): Promise<Match> {
  const base = { parsed, kind: 'show' as const, include: false }
  try {
    const results = await searchShows(parsed.title)
    if (results.length) {
      const { show, episodes } = await getShowWithEpisodes(results[0].id)
      return {
        ...base,
        state: 'ok',
        show,
        episodes: episodesUpTo(episodes, parsed.season, parsed.number),
        include: true,
      }
    }
    if (parsed.season === null && tmdbConfigured) {
      const films = await searchMovies(parsed.title)
      if (films.length) return { ...base, kind: 'movie', state: 'ok', movie: films[0], include: true }
    }
    return { ...base, state: 'notfound' }
  } catch (e) {
    return { ...base, state: 'error', message: (e as Error).message }
  }
}

export function ImportList() {
  const { setWatched, track, addMovies } = useApp()
  const [text, setText] = useState('')
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [phase, setPhase] = useState<'edit' | 'resolving' | 'review' | 'saving' | 'done'>('edit')
  const [progress, setProgress] = useState(0)
  const [saved, setSaved] = useState({ shows: 0, episodes: 0, movies: 0 })

  const lines = parseList(text)

  async function resolve() {
    setPhase('resolving')
    setProgress(0)
    const out: Match[] = []
    for (const parsed of lines) {
      out.push(await resolveLine(parsed))
      setProgress(out.length)
      setMatches([...out])
      await sleep(DELAY)
    }
    setPhase('review')
  }

  async function save() {
    if (!matches) return
    setPhase('saving')
    setProgress(0)
    let shows = 0
    let episodes = 0
    const keep = matches.filter((m) => m.include && m.state === 'ok')
    const films = keep
      .filter((m) => m.kind === 'movie' && m.movie)
      .map((m) => ({ movie: m.movie!, watchedAt: m.parsed.date ?? today() }))

    for (const m of keep.filter((x) => x.kind === 'show' && x.show)) {
      try {
        if (m.episodes?.length) {
          // Une date fournie vaut « à jour à cette date » pour toute la ligne.
          const dates = m.parsed.date
            ? new Map(m.episodes.map((e) => [e.id, isoAt(m.parsed.date!)]))
            : undefined
          await setWatched(m.show!, m.episodes, true, dates)
          episodes += m.episodes.length
        } else {
          await track(m.show!)
        }
        shows++
      } catch {
        /* le contexte affiche déjà l'erreur dans le bandeau */
      }
      setProgress(shows)
    }

    if (films.length) await addMovies(films)
    setSaved({ shows, episodes, movies: films.length })
    setPhase('done')
  }

  function toggle(i: number) {
    setMatches((prev) => prev && prev.map((m, j) => (j === i ? { ...m, include: !m.include } : m)))
  }

  function restart() {
    setText('')
    setMatches(null)
    setPhase('edit')
  }

  if (phase === 'done') {
    return (
      <div className="import__done">
        <h3>Reprise terminée</h3>
        <p>
          {saved.shows} série{saved.shows > 1 ? 's' : ''} ajoutée{saved.shows > 1 ? 's' : ''},{' '}
          {saved.episodes} épisode{saved.episodes > 1 ? 's' : ''} coché{saved.episodes > 1 ? 's' : ''}
          {saved.movies > 0 && `, ${saved.movies} film${saved.movies > 1 ? 's' : ''}`}.
        </p>
        <div className="import__actions">
          <a className="btn btn--primary" href={href.home}>Voir mes séries</a>
          {saved.movies > 0 && <a className="btn btn--ghost" href={href.movies}>Voir mes films</a>}
          <button className="btn btn--ghost" onClick={restart}>Reprendre une autre liste</button>
        </div>
      </div>
    )
  }

  const total = matches?.filter((m) => m.include).length ?? 0

  return (
    <div className="import__list">
      {phase === 'edit' && (
        <>
          <p className="muted">
            Un titre par ligne, suivi du dernier épisode vu : tout ce qui précède sera coché.
            Sans numéro, la série est simplement ajoutée à ta liste. Un titre inconnu au catalogue
            des séries est cherché parmi les films. Pratique pour Prime Video, Disney+ ou Apple TV,
            qui n'exportent pas d'historique.
          </p>
          <p className="muted">
            Tu peux dater une ligne avec <code>@</code> : <code>The Boys S01E08 @ 12/03/2024</code>.
            Sans date, c'est aujourd'hui.
          </p>
          <textarea
            className="import__input"
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={EXAMPLE}
            spellCheck={false}
          />
          <div className="import__actions">
            <button className="btn btn--primary" disabled={!lines.length} onClick={resolve}>
              Analyser {lines.length ? `(${lines.length} ligne${lines.length > 1 ? 's' : ''})` : ''}
            </button>
            {!text && (
              <button className="btn btn--ghost" onClick={() => setText(EXAMPLE)}>
                Voir un exemple
              </button>
            )}
          </div>
        </>
      )}

      {phase === 'resolving' && (
        <p className="muted">Recherche dans le catalogue… {progress} / {lines.length}</p>
      )}

      {phase === 'saving' && (
        <p className="muted">Enregistrement… {progress} / {total}</p>
      )}

      {matches && phase !== 'edit' && (
        <ul className="rows">
          {matches.map((m, i) => (
            <li key={`${m.parsed.raw}-${i}`} className="row">
              {m.state === 'ok' && (m.show || m.movie) ? (
                <>
                  <input
                    type="checkbox"
                    checked={m.include}
                    disabled={phase !== 'review'}
                    onChange={() => toggle(i)}
                    aria-label={`Inclure ${m.show?.name ?? m.movie!.title}`}
                  />
                  <Poster
                    src={m.kind === 'movie' ? m.movie!.poster_url : m.show!.image?.medium}
                    alt={m.show?.name ?? m.movie!.title}
                  />
                  <div className="row__body">
                    <h3>{m.show?.name ?? m.movie!.title}</h3>
                    <p className="muted">
                      {m.kind === 'movie'
                        ? `Film${m.movie!.year ? ` (${m.movie!.year})` : ''}`
                        : m.episodes?.length
                          ? `${m.episodes.length} épisode${m.episodes.length > 1 ? 's' : ''} — ${describeTarget(m.parsed.season, m.parsed.number)}`
                          : describeTarget(m.parsed.season, m.parsed.number)}
                      {m.parsed.date && ` — vu le ${formatShortDate(`${m.parsed.date}T12:00:00.000Z`)}`}
                    </p>
                  </div>
                </>
              ) : (
                <div className="row__body">
                  <h3>{m.parsed.title}</h3>
                  <p className="error">
                    {m.state === 'notfound'
                      ? 'Introuvable au catalogue — essaie le titre original.'
                      : `Erreur : ${m.message}`}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {phase === 'review' && (
        <div className="import__actions">
          <button className="btn btn--primary" disabled={!total} onClick={save}>
            Valider {total ? `(${total})` : ''}
          </button>
          <button className="btn btn--ghost" onClick={() => setPhase('edit')}>
            Modifier la liste
          </button>
        </div>
      )}
    </div>
  )
}
