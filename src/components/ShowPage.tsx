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
  const { isTracked, track, untrack, watchedFor, setWatched, isRewatching } = useApp()
  const [data, setData] = useState<ShowWithEpisodes | null>(null)
  const [error, setError] = useState(false)
  const [catchUp, setCatchUp] = useState<TvEpisode[] | null>(null)
  const [refresh, setRefresh] = useState<'idle' | 'busy' | 'done' | 'nochange' | 'failed'>('idle')
  const [openSeasons, setOpenSeasons] = useState<Set<number>>(new Set())
  // Épisode dont la date de visionnage est en cours d'édition dans la liste détaillée.
  const [editingDate, setEditingDate] = useState<number | null>(null)
  // Saison dont on est en train de choisir une date unique pour tous les épisodes cochés.
  const [bulkDateSeason, setBulkDateSeason] = useState<number | null>(null)

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
    setEditingDate(null)
  }

  function clearDate(ep: TvEpisode) {
    setWatched(show, [ep], true, new Map([[ep.id, null]]), true, true)
    setEditingDate(null)
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
    setBulkDateSeason(null)
  }

  function toggle(ep: TvEpisode) {
    if (!isAired(ep)) return
    if (watched.has(ep.id)) {
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
        return (
          <section key={season} className="season">
            <div className="season__head">
              <h2>Saison {season}</h2>
              <span className="muted">{seen}/{eps.length}</span>
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
                bulkDateSeason === season ? (
                  <input
                    type="date"
                    className="season__bulk-date-input"
                    max={new Date().toISOString().slice(0, 10)}
                    autoFocus
                    onChange={(e) => e.target.value && dateAllTo(eps, e.target.value)}
                    onBlur={() => setBulkDateSeason(null)}
                  />
                ) : (
                  <button
                    className="link-btn season__dates"
                    onClick={() => setBulkDateSeason(season)}
                    title="Mettre la même date sur tous les épisodes déjà cochés de cette saison"
                  >
                    Dater tout à…
                  </button>
                )
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
                        editingDate === ep.id ? (
                          <span className="eplist__date eplist__date--edit">
                            <input
                              type="date"
                              defaultValue={seenAt ? seenAt.slice(0, 10) : ''}
                              max={new Date().toISOString().slice(0, 10)}
                              autoFocus
                              onChange={(e) => e.target.value && editDate(ep, e.target.value)}
                              onBlur={() => setEditingDate(null)}
                            />
                            {seenAt && (
                              <button
                                type="button"
                                className="link-btn"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => clearDate(ep)}
                              >
                                oublier
                              </button>
                            )}
                          </span>
                        ) : editable ? (
                          <button
                            type="button"
                            className="eplist__date eplist__date--seen eplist__date--btn"
                            onClick={() => setEditingDate(ep.id)}
                          >
                            {seenAt ? `Vu le ${formatShortDate(seenAt)}` : 'Vu'}
                          </button>
                        ) : (
                          <span className="eplist__date eplist__date--seen">
                            {seenAt ? `Vu le ${formatShortDate(seenAt)}` : 'Vu'}
                          </span>
                        )
                      ) : (
                        ep.airdate && <span className="eplist__date">{formatDate(ep.airstamp ?? ep.airdate)}</span>
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
    </article>
  )
}
