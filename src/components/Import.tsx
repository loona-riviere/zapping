import { useState } from 'react'
import { useApp } from '../lib/appState'
import { describeTarget, episodesUpTo, parseList, type ParsedLine } from '../lib/bulk'
import { getShowWithEpisodes, searchShows, type TvEpisode, type TvShow } from '../lib/tvmaze'
import { Poster } from './Poster'

// TVmaze tolère ~20 requêtes / 10 s et chaque ligne en consomme deux
// (recherche puis fiche) : on espace pour ne pas se faire limiter.
const DELAY = 800
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Match = {
  parsed: ParsedLine
  state: 'ok' | 'notfound' | 'error'
  show?: TvShow
  episodes?: TvEpisode[]
  message?: string
  include: boolean
}

const EXAMPLE = `Breaking Bad S05E08
The Office S03
Severance 2x04
Dark`

export function Import() {
  const { setWatched, track } = useApp()
  const [text, setText] = useState('')
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [phase, setPhase] = useState<'edit' | 'resolving' | 'review' | 'saving' | 'done'>('edit')
  const [progress, setProgress] = useState(0)
  const [saved, setSaved] = useState({ shows: 0, episodes: 0 })

  const lines = parseList(text)

  async function resolve() {
    setPhase('resolving')
    setProgress(0)
    const out: Match[] = []
    for (const parsed of lines) {
      try {
        const results = await searchShows(parsed.title)
        if (!results.length) {
          out.push({ parsed, state: 'notfound', include: false })
        } else {
          const { show, episodes } = await getShowWithEpisodes(results[0].id)
          out.push({
            parsed,
            state: 'ok',
            show,
            episodes: episodesUpTo(episodes, parsed.season, parsed.number),
            include: true,
          })
        }
      } catch (e) {
        out.push({ parsed, state: 'error', message: (e as Error).message, include: false })
      }
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
    const keep = matches.filter((m) => m.include && m.state === 'ok' && m.show)
    for (const m of keep) {
      try {
        if (m.episodes?.length) {
          await setWatched(m.show!, m.episodes, true)
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
    setSaved({ shows, episodes })
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
      <div className="import">
        <h2 className="section-title">Reprise terminée</h2>
        <p>
          {saved.shows} série{saved.shows > 1 ? 's' : ''} ajoutée{saved.shows > 1 ? 's' : ''},{' '}
          {saved.episodes} épisode{saved.episodes > 1 ? 's' : ''} coché{saved.episodes > 1 ? 's' : ''}.
        </p>
        <div className="import__actions">
          <a className="btn btn--primary" href="#/">Voir mes séries</a>
          <button className="btn btn--ghost" onClick={restart}>Reprendre une autre liste</button>
        </div>
      </div>
    )
  }

  const total = matches?.filter((m) => m.include).length ?? 0

  return (
    <div className="import">
      <h2 className="section-title">Reprise</h2>

      {phase === 'edit' && (
        <>
          <p className="muted">
            Une série par ligne, suivie du dernier épisode vu. Tout ce qui précède sera coché.
            Sans numéro, la série est simplement ajoutée à ta liste.
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
        <p className="muted">Recherche sur TVmaze… {progress} / {lines.length}</p>
      )}

      {phase === 'saving' && (
        <p className="muted">Enregistrement… {progress} / {total}</p>
      )}

      {matches && phase !== 'edit' && (
        <ul className="rows">
          {matches.map((m, i) => (
            <li key={`${m.parsed.raw}-${i}`} className="row">
              {m.state === 'ok' && m.show ? (
                <>
                  <input
                    type="checkbox"
                    checked={m.include}
                    disabled={phase !== 'review'}
                    onChange={() => toggle(i)}
                    aria-label={`Inclure ${m.show.name}`}
                  />
                  <Poster src={m.show.image?.medium} alt={m.show.name} />
                  <div className="row__body">
                    <h3>{m.show.name}</h3>
                    <p className="muted">
                      {m.episodes?.length
                        ? `${m.episodes.length} épisode${m.episodes.length > 1 ? 's' : ''} — ${describeTarget(m.parsed.season, m.parsed.number)}`
                        : describeTarget(m.parsed.season, m.parsed.number)}
                    </p>
                  </div>
                </>
              ) : (
                <div className="row__body">
                  <h3>{m.parsed.title}</h3>
                  <p className="error">
                    {m.state === 'notfound'
                      ? 'Introuvable sur TVmaze — essaie le titre original.'
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
