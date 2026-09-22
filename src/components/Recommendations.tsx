import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useApp } from '../lib/appState'
import { daysSince, mapLimited, rankRecommendations, seedWeight, type Ranked, type SeedList } from '../lib/recommend'
import { href } from '../lib/route'
import {
  movieRecommendations, netflixTopMovies, netflixTopShows, realNetflixTop10Movies, realNetflixTop10Shows,
  tmdbConfigured, tvRecommendationsByImdb,
  type Movie, type RecMovie, type Top10, type TvRec, type TvRecommendation,
} from '../lib/tmdb'
import { searchShows } from '../lib/tvmaze'
import { useShowEpisodes } from '../lib/useShows'
import { Poster } from './Poster'

type Status = 'idle' | 'loading' | 'ready'

// « The Mentalist » (titre original TMDB) vs « Mentalist » (titre suivi,
// souvent sans article) : sans ça, une série déjà suivie repasse en
// recommandation simplement parce que l'article de tête diffère.
const stripArticle = (s: string) => s.replace(/^(the|a|an|le|la|les)\s+/i, '').replace(/^l['’]/i, '')
const normalizeTitle = (s: string) => stripArticle(s.toLowerCase().trim())

function useTrackedNames() {
  const { tracked } = useApp()
  return useMemo(() => new Set(tracked.map((t) => normalizeTitle(t.name))), [tracked])
}

const isTracked = (names: Set<string>, r: TvRecommendation) =>
  names.has(normalizeTitle(r.name)) || names.has(normalizeTitle(r.originalName))

/**
 * TMDB ne connaît pas les identifiants TVmaze : au clic, on cherche le titre
 * chez TVmaze (celui dont l'année colle, sinon le meilleur résultat) et on
 * ouvre sa fiche — sans résultat, on le dit plutôt que de deviner.
 */
function useOpenShow() {
  const [opening, setOpening] = useState<number | null>(null)
  const [notFound, setNotFound] = useState<number | null>(null)

  async function open(r: TvRecommendation) {
    setNotFound(null)
    setOpening(r.id)
    try {
      // TVmaze indexe (presque) toujours sous le titre original : le titre
      // TMDB est souvent en français et n'y donne rien.
      let results = await searchShows(r.name)
      if (!results.length && r.originalName !== r.name) results = await searchShows(r.originalName)
      const match =
        results.find((s) => r.year && s.premiered && Number(s.premiered.slice(0, 4)) === r.year) ?? results[0]
      if (!match) {
        setNotFound(r.id)
        return
      }
      window.location.hash = href.show(match.id)
    } catch {
      setNotFound(r.id)
    } finally {
      setOpening(null)
    }
  }

  return { opening, notFound, open }
}

type TileProps = { note?: string; rank?: number; seen?: boolean; onSkip?: () => void }

function MovieTile({ m, note, rank, seen, onSkip }: TileProps & { m: Movie }) {
  return (
    <li className={seen ? 'shelf__item shelf__item--seen' : 'shelf__item'}>
      <a href={href.movie(m.id)} title={note ? `${m.title} — ${note}` : m.title}>
        <Poster src={m.poster_url} alt={m.title} />
        <span className="shelf__label">{m.title}</span>
        {note && <span className="shelf__because">{note}</span>}
      </a>
      {rank !== undefined && <span className="shelf__rank" aria-label={`Numéro ${rank}`}>{rank}</span>}
      {onSkip && (
        <button type="button" className="shelf__dismiss" onClick={onSkip} aria-label={`Ne plus recommander ${m.title}`}>
          ✕
        </button>
      )}
    </li>
  )
}

function ShowTile({
  r, note, rank, seen, opener, onSkip,
}: TileProps & { r: TvRecommendation; opener: ReturnType<typeof useOpenShow> }) {
  const opening = opener.opening === r.id
  return (
    <li className={seen ? 'shelf__item shelf__item--seen' : 'shelf__item'}>
      <button
        type="button"
        className="shelf__pick"
        onClick={() => opener.open(r)}
        disabled={opening}
        title={note ? `${r.name} — ${note}` : r.name}
      >
        <Poster src={r.poster_url} alt={r.name} />
        <span className="shelf__label">{opening ? 'Ouverture…' : r.name}</span>
        {note && <span className="shelf__because">{note}</span>}
        {opener.notFound === r.id && <span className="error shelf__label">Introuvable chez TVmaze</span>}
      </button>
      {rank !== undefined && <span className="shelf__rank" aria-label={`Numéro ${rank}`}>{rank}</span>}
      {onSkip && (
        <button type="button" className="shelf__dismiss" onClick={onSkip} aria-label={`Ne plus recommander ${r.name}`}>
          ✕
        </button>
      )}
    </li>
  )
}

function RecommendedSection({
  status, count, emptyText, children,
}: {
  status: Status
  count: number
  emptyText: string
  children: ReactNode
}) {
  if (status === 'idle') return null
  return (
    <section>
      <h2 className="section-title">Recommandé pour toi</h2>
      {status === 'loading' && <p className="muted">Recherche de suggestions…</p>}
      {status === 'ready' && !count && (
        <p className="muted">
          {emptyText} Tes suggestions écartées sont dans <a href={href.settings}>Paramètres</a>.
        </p>
      )}
      {status === 'ready' && count > 0 && <ul className="shelf shelf--carousel">{children}</ul>}
    </section>
  )
}

type Seed = { id: number; label: string; weight: number }

/**
 * Suggestions de films. Au lieu de prendre les suggestions TMDB des trois
 * derniers films vus telles quelles, on croise celles de jusqu'à six films
 * aimés (pondérés par la note et la récence) et on retire ce qui ressemble
 * aux films pas aimés — voir lib/recommend.ts pour le détail du score.
 */
export function MovieRecommendations() {
  const { movies, isDismissed, dismissRec } = useApp()

  const seeds = useMemo<Seed[]>(() => {
    const watched = movies.filter((m) => m.status === 'watched')
    const liked = watched
      .filter((m) => m.rating !== 'dislike')
      .map((m) => ({ id: m.movie_id, label: m.title, weight: seedWeight(m.rating, daysSince(m.watched_at)), at: m.watched_at ?? '' }))
      .sort((a, b) => b.weight - a.weight || b.at.localeCompare(a.at))
      .slice(0, 6)
    const disliked = watched
      .filter((m) => m.rating === 'dislike')
      .sort((a, b) => (b.watched_at ?? '').localeCompare(a.watched_at ?? ''))
      .slice(0, 3)
      .map((m) => ({ id: m.movie_id, label: m.title, weight: -2 }))
    return [...liked, ...disliked]
  }, [movies])
  const seedKey = seeds.map((s) => `${s.id}:${s.weight}`).join(',')
  const hasLiked = seeds.some((s) => s.weight > 0)

  const [lists, setLists] = useState<SeedList<RecMovie>[] | null>(null)
  useEffect(() => {
    if (!tmdbConfigured || !hasLiked) return
    let alive = true
    setLists(null)
    mapLimited(seeds, (s) => movieRecommendations(s.id)).then((results) => {
      if (alive) setLists(seeds.map((s, i) => ({ label: s.label, weight: s.weight, items: results[i] })))
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey])

  // Classé à chaque rendu, pas dans l'effet : un film tout juste vu, noté ou
  // écarté sort de la liste (et laisse sa place au suivant) sans refetch.
  const known = useMemo(() => new Set(movies.map((m) => m.movie_id)), [movies])
  const ranked: Ranked<RecMovie>[] = useMemo(
    () => (lists ? rankRecommendations(lists, (m) => known.has(m.id) || isDismissed('movie', m.id)) : []),
    [lists, known, isDismissed],
  )

  const status: Status = !tmdbConfigured || !hasLiked ? 'idle' : lists ? 'ready' : 'loading'
  return (
    <RecommendedSection status={status} count={ranked.length} emptyText="Rien de nouveau à te proposer pour l'instant.">
      {ranked.map(({ item: m, because }) => (
        <MovieTile key={m.id} m={m} note={`Comme ${because}`} onSkip={() => dismissRec('movie', m.id, m.title, m.poster_url)} />
      ))}
    </RecommendedSection>
  )
}

/**
 * Suggestions de séries, même principe que les films : jusqu'à six séries
 * aimées (note, récence, revisionnages) en base, et les séries pas aimées ou
 * abandonnées en contre-exemples. Le pont TVmaze → TMDB passe par l'IMDb ID,
 * d'où le chargement des fiches TVmaze des séries de base.
 */
export function ShowRecommendations() {
  const { tracked, isDismissed, dismissRec } = useApp()
  const trackedNames = useTrackedNames()
  const opener = useOpenShow()

  const seeds = useMemo<Seed[]>(() => {
    // Des séries vraiment regardées, pas juste ajoutées « à voir ».
    const started = tracked.filter((t) => t.last_watched_at)
    const liked = started
      .filter((t) => t.rating !== 'dislike' && t.status !== 'dropped')
      .map((t) => ({
        id: t.show_id,
        label: t.name,
        // Revue en entier au moins une fois : un vrai coup de cœur, même sans note.
        weight: seedWeight(t.rating, daysSince(t.last_watched_at)) + (t.rewatches > 0 ? 1 : 0),
        at: t.last_watched_at ?? '',
      }))
      .sort((a, b) => b.weight - a.weight || b.at.localeCompare(a.at))
      .slice(0, 6)
    const disliked = started
      .filter((t) => t.rating === 'dislike' || t.status === 'dropped')
      .sort((a, b) => (b.last_watched_at ?? '').localeCompare(a.last_watched_at ?? ''))
      .slice(0, 3)
      // Pas aimée : contre-exemple franc. Abandonnée sans note : plus nuancé.
      .map((t) => ({ id: t.show_id, label: t.name, weight: t.rating === 'dislike' ? -2 : -1 }))
    return [...liked, ...disliked]
  }, [tracked])
  const hasLiked = seeds.some((s) => s.weight > 0)

  const seedIds = useMemo(() => seeds.map((s) => s.id), [seeds])
  const { data, failed } = useShowEpisodes(seedIds)
  // Une fiche TVmaze en échec compte comme résolue (sans IMDb ID) : sinon une
  // seule série injoignable bloquait toutes les suggestions indéfiniment.
  const stillResolving = seedIds.some((id) => !data[id] && !failed.has(id))
  const imdbs = seeds.map((s) => data[s.id]?.show.externals?.imdb ?? null)
  const fetchKey = stillResolving ? '' : seeds.map((s, i) => `${imdbs[i]}:${s.weight}`).join(',')

  const [lists, setLists] = useState<SeedList<TvRec>[] | null>(null)
  useEffect(() => {
    if (!tmdbConfigured || !hasLiked || !fetchKey) return
    let alive = true
    setLists(null)
    mapLimited(imdbs, (imdb) => tvRecommendationsByImdb(imdb)).then((results) => {
      if (alive) setLists(seeds.map((s, i) => ({ label: s.label, weight: s.weight, items: results[i] })))
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey])

  const ranked: Ranked<TvRec>[] = useMemo(
    () =>
      lists
        ? rankRecommendations(lists, (r) => isTracked(trackedNames, r) || isDismissed('show', r.id), { maxAge: 12 })
        : [],
    [lists, trackedNames, isDismissed],
  )

  const status: Status = !tmdbConfigured || !hasLiked ? 'idle' : lists ? 'ready' : 'loading'
  return (
    <RecommendedSection status={status} count={ranked.length} emptyText="Rien de nouveau à te proposer pour l'instant.">
      {ranked.map(({ item: r, because }) => (
        <ShowTile
          key={r.id}
          r={r}
          note={`Comme ${because}`}
          opener={opener}
          onSkip={() => dismissRec('show', r.id, r.name, r.poster_url)}
        />
      ))}
    </RecommendedSection>
  )
}

/**
 * Le classement officiel Netflix France de la dernière semaine publiée ; à
 * défaut (fichier Netflix injoignable), une approximation TMDB « populaire
 * sur Netflix ». On attend la fin du chargement de la bibliothèque
 * (`loading`) pour que les marques « déjà vu » soient justes d'emblée.
 */
function useNetflixTop<T>(real: () => Promise<Top10<T> | null>, approx: () => Promise<T[]>) {
  const { loading } = useApp()
  const [top, setTop] = useState<Top10<T> | null>(null)
  const [fallback, setFallback] = useState<T[] | null>(null)

  useEffect(() => {
    if (!tmdbConfigured || loading) return
    let alive = true
    ;(async () => {
      const found = await real().catch(() => null)
      if (!alive) return
      if (found?.entries.length) return setTop(found)
      const list = await approx()
      if (alive) setFallback(list)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  return { top, fallback }
}

/** « 2026-09-20 » (dimanche de fin de semaine chez Netflix) → « 14 – 20 sept. » */
function weekLabel(end: string) {
  const to = new Date(`${end}T12:00:00`)
  if (Number.isNaN(to.getTime())) return ''
  const from = new Date(to.getTime() - 6 * 86_400_000)
  const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  return `${from.getMonth() === to.getMonth() ? from.getDate() : fmt(from)} – ${fmt(to)}`
}

const weeksNote = (weeks: number) => (weeks <= 1 ? 'Nouveau' : `${weeks}e semaine`)

function TopSection({ week, children }: { week?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="section-title">{week ? 'Top 10 Netflix France' : 'Populaire sur Netflix'}</h2>
      {week && <p className="muted shelf__caption">Classement officiel Netflix, semaine du {weekLabel(week)}</p>}
      <ul className="shelf shelf--carousel">{children}</ul>
    </section>
  )
}

/** Titre du classement sans fiche TMDB certaine : affiché quand même, et renvoie vers la recherche. */
function UnmatchedTile({ title, rank, weeks, kind }: { title: string; rank: number; weeks: number; kind: 'show' | 'movie' }) {
  return (
    <li className="shelf__item">
      <a href={href.searchFor(title, kind)} title={title}>
        <Poster src={null} alt={title} />
        <span className="shelf__label">{title}</span>
        <span className="shelf__because">{weeksNote(weeks)}</span>
      </a>
      <span className="shelf__rank" aria-label={`Numéro ${rank}`}>{rank}</span>
    </li>
  )
}

export function NetflixTopMovies() {
  const { movies, isDismissed, dismissRec } = useApp()
  const { top, fallback } = useNetflixTop<Movie>(realNetflixTop10Movies, netflixTopMovies)
  const mine = useMemo(() => new Map(movies.map((m) => [m.movie_id, m])), [movies])

  if (top) {
    return (
      <TopSection week={top.week}>
        {top.entries.map((e) => {
          if (!e.match) return <UnmatchedTile key={`u${e.rank}`} title={e.title} rank={e.rank} weeks={e.weeks} kind="movie" />
          const own = mine.get(e.match.id)
          const note = own ? (own.status === 'watched' ? 'Déjà vu' : 'Dans ta liste') : weeksNote(e.weeks)
          return <MovieTile key={e.match.id} m={e.match} rank={e.rank} note={note} seen={own?.status === 'watched'} />
        })}
      </TopSection>
    )
  }

  // Repli : une simple sélection populaire, où masquer le déjà-vu a du sens.
  const visible = (fallback ?? []).filter((m) => !mine.has(m.id) && !isDismissed('movie', m.id))
  if (!visible.length) return null
  return (
    <TopSection>
      {visible.map((m) => (
        <MovieTile key={m.id} m={m} onSkip={() => dismissRec('movie', m.id, m.title, m.poster_url)} />
      ))}
    </TopSection>
  )
}

export function NetflixTopShows() {
  const { tracked, isDismissed, dismissRec } = useApp()
  const trackedNames = useTrackedNames()
  const opener = useOpenShow()
  const { top, fallback } = useNetflixTop<TvRecommendation>(realNetflixTop10Shows, netflixTopShows)
  const byName = useMemo(() => new Map(tracked.map((t) => [normalizeTitle(t.name), t])), [tracked])

  if (top) {
    return (
      <TopSection week={top.week}>
        {top.entries.map((e) => {
          if (!e.match) return <UnmatchedTile key={`u${e.rank}`} title={e.title} rank={e.rank} weeks={e.weeks} kind="show" />
          const r = e.match
          const own = byName.get(normalizeTitle(r.name)) ?? byName.get(normalizeTitle(r.originalName))
          const note = own ? (own.status === 'later' ? 'Dans ta liste' : 'Suivie') : weeksNote(e.weeks)
          return <ShowTile key={r.id} r={r} rank={e.rank} note={note} seen={!!own && own.status !== 'later'} opener={opener} />
        })}
      </TopSection>
    )
  }

  const visible = (fallback ?? []).filter((r) => !isTracked(trackedNames, r) && !isDismissed('show', r.id))
  if (!visible.length) return null
  return (
    <TopSection>
      {visible.map((r) => (
        <ShowTile key={r.id} r={r} opener={opener} onSkip={() => dismissRec('show', r.id, r.name, r.poster_url)} />
      ))}
    </TopSection>
  )
}
