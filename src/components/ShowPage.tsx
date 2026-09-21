import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../lib/appState'
import { computeProgress, epCode, formatDate, formatShortDate, isAired } from '../lib/progress'
import { href } from '../lib/route'
import { getShowWithEpisodes, statusFr, stripHtml, type ShowWithEpisodes, type TvEpisode } from '../lib/tvmaze'
import { Poster } from './Poster'
import { Rewatches } from './Rewatches'
import { StatusPicker } from './StatusPicker'
import { WhereToWatch } from './WhereToWatch'

export function ShowPage({ id }: { id: number }) {
  const { isTracked, track, untrack, watchedFor, historyFor, setWatched, isRewatching } = useApp()
  const [data, setData] = useState<ShowWithEpisodes | null>(null)
  const [error, setError] = useState(false)
  const [catchUp, setCatchUp] = useState<TvEpisode[] | null>(null)
  const [confirmUncheck, setConfirmUncheck] = useState<TvEpisode | null>(null)
  const [refresh, setRefresh] = useState<'idle' | 'busy' | 'done' | 'nochange' | 'failed'>('idle')
  const [openSeasons, setOpenSeasons] = useState<Set<number>>(new Set())
  const [openSummaries, setOpenSummaries] = useState<Set<number>>(new Set())

  useEffect(() => {
    let alive = true
    setData(null)
    setError(false)
    setRefresh('idle')
    getShowWithEpisodes(id)
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [id])

  const watched = watchedFor(id)
  // Pendant un revisionnage, `watched` ne montre que la passe en cours :
  // l'historique complet reste consultable à part, pour ne pas perdre de vue
  // ce qui a déjà été vu avant (ex. saisons pas encore recochées cette fois-ci).
  const history = historyFor(id)
  const rewatching = isRewatching(id)
  const seasons = useMemo(() => {
    const map = new Map<number, TvEpisode[]>()
    data?.episodes.forEach((e) => {
      if (!map.has(e.season)) map.set(e.season, [])
      map.get(e.season)!.push(e)
    })
    return [...map.entries()]
  }, [data])

  if (error) return <p className="error pad">Impossible de charger cette série depuis TVmaze. <a href={href.home}>Retour</a></p>
  if (!data) return <p className="muted pad">Chargement…</p>

  const { show, episodes } = data
  const followed = isTracked(show.id)
  const progress = computeProgress(episodes, watched)
  const channel = show.network?.name ?? show.webChannel?.name
  const summary = stripHtml(show.summary)

  /** Un jour seul : on horodate à midi pour éviter les sauts de fuseau. */
  const isoAtNoon = (day: string) => `${day}T12:00:00.000Z`

  /**
   * Corrige la date d'un épisode déjà coché — « je l'ai vu hier, pas
   * aujourd'hui ». `overwrite` (déjà utilisé par les imports) fait que la
   * ligne existante est réécrite plutôt qu'ignorée.
   */
  function editDate(ep: TvEpisode, day: string) {
    setWatched(show, [ep], true, new Map([[ep.id, isoAtNoon(day)]]), true, true)
  }

  function clearDate(ep: TvEpisode) {
    setWatched(show, [ep], true, new Map([[ep.id, null]]), true, true)
  }

  /**
   * « Je les ai vus à peu près à leur sortie » : plutôt que corriger épisode
   * par épisode, on reprend la date de diffusion que TVmaze connaît déjà
   * pour chacun des épisodes cochés de la saison.
   */
  function dateToAirdates(eps: TvEpisode[]) {
    const seen = eps.filter((e) => watched.has(e.id) && (e.airstamp || e.airdate))
    if (!seen.length) return
    const dates = new Map(seen.map((e) => [e.id, e.airstamp ?? isoAtNoon(e.airdate)]))
    setWatched(show, seen, true, dates, true, true)
  }

  /**
   * « Je les ai tous vus le même jour » (marathon, import approximatif...) :
   * une seule date pour tous les épisodes déjà cochés de la saison.
   */
  function dateAllTo(eps: TvEpisode[], day: string) {
    const seen = eps.filter((e) => watched.has(e.id))
    if (!seen.length) return
    const at = isoAtNoon(day)
    setWatched(show, seen, true, new Map(seen.map((e) => [e.id, at])), true, true)
  }

  function toggle(ep: TvEpisode) {
    if (!isAired(ep)) return
    if (watched.has(ep.id)) {
      // Pendant un revisionnage, décocher est irréversible sans y repenser :
      // recocher remet la date du jour, pas celle d'origine. Une confirmation
      // évite qu'un faux clic écrase une vraie date.
      if (rewatching) {
        setConfirmUncheck(ep)
        return
      }
      setCatchUp(null)
      setWatched(show, [ep], false)
      return
    }
    setWatched(show, [ep], true)
    // Propose de cocher les épisodes précédents encore non vus, comme TVTime.
    const idx = episodes.findIndex((e) => e.id === ep.id)
    const before = episodes.slice(0, idx).filter((e) => isAired(e) && !watched.has(e.id))
    setCatchUp(before.length ? before : null)
  }

  function uncheck(ep: TvEpisode) {
    setCatchUp(null)
    setConfirmUncheck(null)
    setWatched(show, [ep], false)
  }

  function toggleSeason(eps: TvEpisode[]) {
    const aired = eps.filter((e) => isAired(e))
    const allSeen = aired.every((e) => watched.has(e.id))
    setCatchUp(null)
    setWatched(show, allSeen ? aired : aired.filter((e) => !watched.has(e.id)), !allSeen)
  }

  /**
   * TVmaze est alimenté par sa communauté : une saison récente peut y arriver
   * après coup, alors que le navigateur garde la fiche 12 h. Ce bouton refait
   * l'appel en ignorant le cache.
   */
  async function reload() {
    setRefresh('busy')
    try {
      const fresh = await getShowWithEpisodes(id, true)
      const before = episodes.length
      setData(fresh)
      setRefresh(fresh.episodes.length > before ? 'done' : 'nochange')
    } catch {
      setRefresh('failed')
    }
  }

  function toggleList(season: number) {
    setOpenSeasons((prev) => {
      const next = new Set(prev)
      next.has(season) ? next.delete(season) : next.add(season)
      return next
    })
  }

  function toggleSummary(episodeId: number) {
    setOpenSummaries((prev) => {
      const next = new Set(prev)
      next.has(episodeId) ? next.delete(episodeId) : next.add(episodeId)
      return next
    })
  }

  return (
    <article className="show">
      <header className="show__head">
        <Poster src={show.image?.original ?? show.image?.medium} alt={show.name} size="lg" />
        <div className="show__meta">
          <h1>{show.name}</h1>
          <p className="muted">{[show.premiered?.slice(0, 4), channel, statusFr(show.status)].filter(Boolean).join(', ')}</p>
          {progress.aired > 0 && (
            <p className="show__count">
              <strong>{progress.watched}</strong> sur {progress.aired} épisodes vus
            </p>
          )}
          <button
            className={`btn ${followed ? 'btn--ghost' : 'btn--primary'}`}
            onClick={() => {
              if (!followed) track(show)
              else if (confirm(`Retirer ${show.name} et effacer ta progression ?`)) untrack(show.id)
            }}
          >
            {followed ? 'Retirer de mes séries' : 'Suivre cette série'}
          </button>
          {followed && <Rewatches show={show} episodes={episodes} />}
          {followed && (
            <p className="show__status">
              <label htmlFor="show-status">Statut</label>
              <StatusPicker showId={show.id} id="show-status" />
            </p>
          )}
        </div>
      </header>

      <WhereToWatch imdbId={show.externals?.imdb} />

      {summary && <p className="show__summary">{summary}</p>}

      {seasons.map(([season, eps]) => {
        const aired = eps.filter((e) => isAired(e))
        const seen = aired.filter((e) => watched.has(e.id)).length
        const complete = aired.length > 0 && seen === aired.length
        const open = openSeasons.has(season)
        // Pendant un revisionnage : ce que cette saison portait avant, pour ne
        // pas perdre de vue une saison déjà vue mais pas encore recochée.
        const historyCount = rewatching ? aired.filter((e) => history.has(e.id)).length : 0
        const historyLast = rewatching
          ? aired.reduce<string | null>((max, e) => {
              const d = history.get(e.id)
              return d && (!max || d > max) ? d : max
            }, null)
          : null
        return (
          <section key={season} className="season">
            <div className="season__head">
              <h2>Saison {season}</h2>
              <span className="muted">{seen}/{eps.length}</span>
              {historyCount > 0 && seen < aired.length && (
                <span
                  className="muted season__history"
                  title="Ta progression du visionnage précédent, indépendante de ce revisionnage"
                >
                  déjà vue ({historyCount}/{aired.length}){historyLast ? `, dernière fois le ${formatShortDate(historyLast)}` : ''}
                </span>
              )}
              {aired.length > 0 && (
                <button className="link-btn" onClick={() => toggleSeason(eps)}>
                  {complete ? 'Tout décocher' : 'Tout cocher'}
                </button>
              )}
              {seen > 0 && !isRewatching(show.id) && (
                <button
                  className="link-btn season__dates"
                  onClick={() => dateToAirdates(eps)}
                  title="Reprend la date de diffusion d'origine de chaque épisode déjà coché"
                >
                  Dater à la diffusion
                </button>
              )}
              {seen > 0 && !isRewatching(show.id) && (
                <label className="season__bulk-date" title="Mettre la même date sur tous les épisodes déjà cochés de cette saison">
                  Dater tout à…
                  <input
                    type="date"
                    className="season__bulk-date-input"
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => e.target.value && dateAllTo(eps, e.target.value)}
                  />
                </label>
              )}
            </div>

            <div className="tiles">
              {eps.map((ep) => {
                const on = watched.has(ep.id)
                const out = isAired(ep)
                const isNext = progress.next?.id === ep.id
                return (
                  <button
                    key={ep.id}
                    className={`tile${on ? ' tile--on' : ''}${!out ? ' tile--future' : ''}${isNext ? ' tile--next' : ''}`}
                    aria-pressed={on}
                    disabled={!out}
                    title={`${epCode(ep)} ${ep.name}${
                      on
                        ? watched.get(ep.id)
                          ? `, vu le ${formatShortDate(watched.get(ep.id)!)}`
                          : ', vu'
                        : out
                          ? ''
                          : `, le ${formatDate(ep.airstamp ?? ep.airdate)}`
                    }`}
                    aria-label={`${epCode(ep)} ${ep.name}${!out ? ', pas encore diffusé' : on ? ', vu' : ''}`}
                    onClick={() => toggle(ep)}
                  >
                    {ep.number}
                  </button>
                )
              })}
            </div>

            <button className="link-btn season__more" aria-expanded={open} onClick={() => toggleList(season)}>
              {open ? 'Masquer les titres' : 'Voir les titres'}
            </button>
            {open && (
              <ol className="eplist">
                {eps.map((ep) => {
                  const out = isAired(ep)
                  const seenAt = watched.get(ep.id)
                  const editable = watched.has(ep.id) && !isRewatching(show.id)
                  return (
                    <li key={ep.id}>
                      <label className={out ? '' : 'is-future'}>
                        <input type="checkbox" checked={watched.has(ep.id)} disabled={!out} onChange={() => toggle(ep)} />
                        <span className="eplist__code">{epCode(ep)}</span>
                        <span className="eplist__name">{ep.name}</span>
                      </label>
                      {watched.has(ep.id) ? (
                        editable ? (
                          <span className="eplist__date eplist__date--edit">
                            <input
                              type="date"
                              value={seenAt ? seenAt.slice(0, 10) : ''}
                              max={new Date().toISOString().slice(0, 10)}
                              onChange={(e) => e.target.value && editDate(ep, e.target.value)}
                            />
                            {seenAt && (
                              <button type="button" className="link-btn" onClick={() => clearDate(ep)}>
                                oublier
                              </button>
                            )}
                          </span>
                        ) : (
                          <span className="eplist__date eplist__date--seen">
                            {seenAt ? `Vu le ${formatShortDate(seenAt)}` : 'Vu'}
                          </span>
                        )
                      ) : rewatching && history.has(ep.id) ? (
                        <span className="eplist__date eplist__date--history" title="Vu lors d'un visionnage précédent">
                          Déjà vu{history.get(ep.id) ? ` le ${formatShortDate(history.get(ep.id)!)}` : ''}
                        </span>
                      ) : (
                        ep.airdate && <span className="eplist__date">{formatDate(ep.airstamp ?? ep.airdate)}</span>
                      )}
                      {ep.summary && (
                        <>
                          <button
                            type="button"
                            className="link-btn eplist__toggle"
                            onClick={() => toggleSummary(ep.id)}
                          >
                            {openSummaries.has(ep.id) ? 'Masquer le résumé' : 'Résumé'}
                          </button>
                          {openSummaries.has(ep.id) && (
                            <p className="eplist__summary muted">{stripHtml(ep.summary)}</p>
                          )}
                        </>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
        )
      })}

      <p className="show__refresh muted">
        Il manque une saison ou des épisodes ?{' '}
        <button className="link-btn" disabled={refresh === 'busy'} onClick={reload}>
          {refresh === 'busy' ? 'Mise à jour…' : 'Recharger depuis TVmaze'}
        </button>
        {refresh === 'done' && ' — fiche mise à jour.'}
        {refresh === 'failed' && ' — échec, réessaie plus tard.'}
        {refresh === 'nochange' && (
          <>
            {' '}— rien de neuf chez eux. TVmaze est alimenté par sa communauté :{' '}
            <a href={`https://www.tvmaze.com/shows/${show.id}`} target="_blank" rel="noreferrer">
              la saison manquante s'ajoute sur leur fiche
            </a>, et elle apparaîtra ici ensuite.
          </>
        )}
      </p>

      {catchUp && (
        <div className="catchup" role="status">
          <p>
            {catchUp.length === 1
              ? "Cocher aussi l'épisode précédent ?"
              : `Cocher aussi les ${catchUp.length} épisodes précédents ?`}
          </p>
          <div className="catchup__actions">
            <button className="btn btn--ghost" onClick={() => setCatchUp(null)}>Non</button>
            <button
              className="btn btn--primary"
              onClick={() => {
                setWatched(show, catchUp, true)
                setCatchUp(null)
              }}
            >
              Cocher
            </button>
          </div>
        </div>
      )}

      {confirmUncheck && (
        <div className="catchup" role="status">
          <p>
            Décocher {epCode(confirmUncheck)} ? En revisionnage, la recocher remettra la date
            d'aujourd'hui, pas celle d'origine.
          </p>
          <div className="catchup__actions">
            <button className="btn btn--ghost" onClick={() => setConfirmUncheck(null)}>Annuler</button>
            <button className="btn btn--primary" onClick={() => uncheck(confirmUncheck)}>Décocher</button>
          </div>
        </div>
      )}
    </article>
  )
}
