import { useEffect, useMemo, useRef, useState } from 'react'
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
  // Épisode ou saison qui recevra la date choisie dans le picker partagé ci-dessous.
  const [editingDate, setEditingDate] = useState<number | null>(null)
  const [bulkDateSeason, setBulkDateSeason] = useState<number | null>(null)
  // Un seul <input type="date"> caché, réutilisé pour toutes les saisons/épisodes :
  // le rendre à la demande dans chaque ligne cassait le picker natif sur mobile
  // (voir openDatePicker ci-dessous).
  const dateInputRef = useRef<HTMLInputElement>(null)

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

  /**
   * Ouvre le picker de date partagé pour un épisode ou une saison entière.
   * `showPicker()` doit être appelé de façon synchrone dans le gestionnaire
   * de clic pour rester rattaché au geste de l'utilisateur — sinon, sur
   * mobile, iOS et Android referment le calendrier au bout de quelques
   * secondes (un champ qui vient d'apparaître avec autoFocus arrive trop
   * tard pour compter comme le même geste).
   */
  function openDatePicker(target: number | TvEpisode) {
    if (typeof target === 'number') setBulkDateSeason(target)
    else setEditingDate(target.id)
    const input = dateInputRef.current
    if (!input) return
    try {
      // showPicker() exige un champ « visible » selon certains moteurs (Safari
      // notamment) : un champ masqué par clip (0 pixel peint) peut s'y refuser
      // sans erreur exploitable ailleurs que par cet essai/repli.
      input.showPicker()
    } catch {
      input.focus()
    }
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
      {/* Champ caché unique, ouvert impérativement par openDatePicker() : voir
          sa documentation pour pourquoi il n'est pas rendu à la demande. */}
      <input
        ref={dateInputRef}
        type="date"
        className="date-picker-host"
        max={new Date().toISOString().slice(0, 10)}
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const day = e.target.value
          if (!day) return
          if (bulkDateSeason !== null) {
            const eps = seasons.find(([s]) => s === bulkDateSeason)?.[1] ?? []
            dateAllTo(eps, day)
          } else if (editingDate !== null) {
            const ep = episodes.find((e) => e.id === editingDate)
            if (ep) editDate(ep, day)
          }
          e.target.value = ''
        }}
      />
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
                <button
                  className="link-btn season__dates"
                  onClick={() => openDatePicker(season)}
                  title="Mettre la même date sur tous les épisodes déjà cochés de cette saison"
                >
                  Dater tout à…
                </button>
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
                            <button
                              type="button"
                              className="eplist__date--seen eplist__date--btn"
                              onClick={() => openDatePicker(ep)}
                            >
                              {seenAt ? `Vu le ${formatShortDate(seenAt)}` : 'Vu'}
                            </button>
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
