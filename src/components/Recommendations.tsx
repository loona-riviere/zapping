import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  dismissedNames, generateAiPicks, libraryLines, loadAiPicks, type AiCandidate, type AiResult,
} from '../lib/ai'
import { useApp } from '../lib/appState'
import { daysSince, mapLimited, rankRecommendations, seedWeight, type Ranked, type SeedList } from '../lib/recommend'
import { href } from '../lib/route'
import {
  discoverRecentMovies, discoverRecentShows, movieRecommendations, realNetflixTop10Movies,
  realNetflixTop10Shows, tmdbConfigured, tvRecommendationsByImdb,
  type Movie, type RecMovie, type TvRec, type TvRecommendation,
} from '../lib/tmdb'
import { searchShows } from '../lib/tvmaze'
import { useShowEpisodes } from '../lib/useShows'
import { Poster } from './Poster'

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

type Opener = ReturnType<typeof useOpenShow>

function Dismiss({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="shelf__dismiss" onClick={onClick} aria-label={`Ne plus recommander ${label}`}>
      ✕
    </button>
  )
}

/* ---------- Vignettes de secours (sans Gemini) ---------- */

function MovieTile({ m, note, onSkip }: { m: Movie; note: string; onSkip: () => void }) {
  return (
    <li className="shelf__item">
      <a href={href.movie(m.id)} title={`${m.title} — ${note}`}>
        <Poster src={m.poster_url} alt={m.title} />
        <span className="shelf__label">{m.title}</span>
        <span className="shelf__because">{note}</span>
      </a>
      <Dismiss label={m.title} onClick={onSkip} />
    </li>
  )
}

function ShowTile({ r, note, opener, onSkip }: { r: TvRecommendation; note: string; opener: Opener; onSkip: () => void }) {
  const opening = opener.opening === r.id
  return (
    <li className="shelf__item">
      <button type="button" className="shelf__pick" onClick={() => opener.open(r)} disabled={opening} title={`${r.name} — ${note}`}>
        <Poster src={r.poster_url} alt={r.name} />
        <span className="shelf__label">{opening ? 'Ouverture…' : r.name}</span>
        <span className="shelf__because">{note}</span>
        {opener.notFound === r.id && <span className="error shelf__label">Introuvable chez TVmaze</span>}
      </button>
      <Dismiss label={r.name} onClick={onSkip} />
    </li>
  )
}

/* ---------- Cartes Gemini : affiche, titre, raison ---------- */

function AiCardBody({ poster, title, reason, tag, status }: {
  poster: string | null
  title: string
  reason: string
  tag?: string
  status?: ReactNode
}) {
  return (
    <>
      <Poster src={poster} alt={title} />
      <span className="aicard__body">
        <span className="aicard__title">{title}</span>
        {tag && <span className="aicard__tag">{tag}</span>}
        <span className="aicard__reason">{status ?? reason}</span>
      </span>
    </>
  )
}

/* ---------- Sélection Gemini ---------- */

type Pooled<T> = { item: T; cand: AiCandidate }
type AiState<T> = {
  result: AiResult<T> | null
  generating: boolean
  error: string | null
  notice: string | null
  refresh: () => void
}

/**
 * Sélection Gemini : d'abord celle en cache (appareil, puis base), sans
 * appeler Gemini. S'il n'y en a pas ou qu'elle a plus de 24 h, on rassemble
 * les candidats (`gather`, une fois `ready`) et on en demande une nouvelle.
 */
function useAiPicks<T extends { id: number }>(
  kind: 'show' | 'movie',
  ready: boolean,
  gather: () => Promise<Pooled<T>[]>,
): AiState<T> {
  const { tracked, movies, dismissed } = useApp()
  const [result, setResult] = useState<AiResult<T> | null>(null)
  const [stale, setStale] = useState(false)
  const [force, setForce] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Les candidats et la bibliothèque du moment où l'on génère, pas ceux du
  // rendu où l'effet a été programmé.
  const latest = useRef({ gather, tracked, movies, dismissed, result })
  latest.current = { gather, tracked, movies, dismissed, result }

  useEffect(() => {
    let alive = true
    loadAiPicks<T>(kind)
      .then(({ result: r, stale: s }) => {
        if (!alive) return
        if (r) setResult(r)
        setStale(s || !r)
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [kind])

  useEffect(() => {
    if (!ready || !(stale || force)) return
    let alive = true
    setGenerating(true)
    setNotice(null)
    const { gather: g, tracked: t, movies: m, dismissed: d, result: before } = latest.current
    ;(async () => {
      const pool = await g()
      const r = await generateAiPicks(kind, libraryLines(t, m), dismissedNames(d), pool, force > 0)
      if (!alive) return
      setStale(false)
      if (r.picks.length) setResult(r)
      setError(r.error ?? null)
      if (force && before && r.generatedAt === before.generatedAt) {
        setNotice('Déjà actualisée il y a moins de 6 h.')
      }
    })()
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setGenerating(false))
    return () => {
      alive = false
    }
  }, [kind, ready, stale, force])

  return { result, generating, error, notice, refresh: () => setForce((n) => n + 1) }
}

function RecommendedSection({ ai, children }: { ai: AiState<unknown>; children: ReactNode }) {
  return (
    <section>
      <h2 className="section-title">Recommandé pour toi</h2>
      {children}
      <p className="muted shelf__caption shelf__caption--after">
        {ai.result?.picks.length
          ? 'Choisies par Gemini d’après tout ce que tu regardes. '
          : ai.generating
            ? 'Gemini prépare ta sélection… '
            : ai.error
              ? `Sélection Gemini indisponible (${ai.error}). `
              : ''}
        {ai.result?.picks.length && !ai.generating ? (
          <button type="button" className="link-btn" onClick={ai.refresh}>
            Actualiser
          </button>
        ) : null}
        {ai.notice && ` ${ai.notice}`}
      </p>
    </section>
  )
}

type Seed = { id: number; label: string; weight: number }

/**
 * Suggestions de films. Gemini choisit et explique, parmi : les films que
 * TMDB rapproche de ceux aimés (déjà classés par lib/recommend.ts), le Top 10
 * Netflix France de la semaine, et les films récents dispos en abonnement.
 * Sans Gemini, le classement lib/recommend.ts s'affiche tel quel.
 */
export function MovieRecommendations() {
  const { movies, isDismissed, dismissRec, loading } = useApp()

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
  const hidden = (id: number) => known.has(id) || isDismissed('movie', id)
  const ranked: Ranked<RecMovie>[] = useMemo(
    () => (lists ? rankRecommendations(lists, (m) => hidden(m.id), { limit: 40 }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lists, known, isDismissed],
  )

  const ai = useAiPicks<Movie>('movie', tmdbConfigured && !loading && (lists !== null || !hasLiked), async () => {
    const pool = new Map<number, Pooled<Movie>>()
    const add = (m: Movie & Partial<RecMovie>, tag?: string) => {
      if (hidden(m.id)) return
      const prev = pool.get(m.id)
      if (prev) {
        if (tag && !prev.cand.tag) prev.cand.tag = tag
        return
      }
      pool.set(m.id, {
        item: { id: m.id, title: m.title, poster_url: m.poster_url, year: m.year, release_date: m.release_date, overview: null },
        cand: { id: m.id, title: m.title, year: m.year, genreIds: m.genreIds ?? [], overview: m.overview, vote: m.vote, tag },
      })
    }
    const top = await realNetflixTop10Movies().catch(() => null)
    top?.entries.forEach((e) => e.match && add(e.match, `Top 10 Netflix n°${e.rank}`))
    ranked.forEach((r) => add(r.item))
    ;(await discoverRecentMovies()).forEach((m) => add(m))
    return [...pool.values()].slice(0, 100)
  })

  const aiVisible = (ai.result?.picks ?? []).filter((p) => !hidden(p.item.id))
  const fallback = ranked.slice(0, 20)
  if (!tmdbConfigured || (!aiVisible.length && !fallback.length && !ai.generating)) return null

  return (
    <RecommendedSection ai={ai}>
      {aiVisible.length > 0 ? (
        <ul className="shelf shelf--carousel shelf--cards">
          {aiVisible.map(({ item: m, reason, tag }) => (
            <li key={m.id} className="shelf__item">
              <a className="aicard" href={href.movie(m.id)}>
                <AiCardBody poster={m.poster_url} title={m.title} reason={reason} tag={tag} />
              </a>
              <Dismiss label={m.title} onClick={() => dismissRec('movie', m.id, m.title, m.poster_url)} />
            </li>
          ))}
        </ul>
      ) : fallback.length > 0 ? (
        <ul className="shelf shelf--carousel">
          {fallback.map(({ item: m, because }) => (
            <MovieTile key={m.id} m={m} note={`Comme ${because}`} onSkip={() => dismissRec('movie', m.id, m.title, m.poster_url)} />
          ))}
        </ul>
      ) : null}
    </RecommendedSection>
  )
}

/**
 * Suggestions de séries, même principe que les films. Le pont TVmaze → TMDB
 * passe par l'IMDb ID, d'où le chargement des fiches TVmaze des séries de
 * base (jusqu'à six séries aimées, et les pas aimées ou abandonnées en
 * contre-exemples).
 */
export function ShowRecommendations() {
  const { tracked, isDismissed, dismissRec, loading } = useApp()
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

  const hidden = (r: TvRecommendation) => isTracked(trackedNames, r) || isDismissed('show', r.id)
  const ranked: Ranked<TvRec>[] = useMemo(
    // Filtre dur à 12 ans : TMDB rapproche volontiers une sitcom adorée de
    // sitcoms des années 80-90.
    () => (lists ? rankRecommendations(lists, hidden, { limit: 40, maxAge: 12 }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lists, trackedNames, isDismissed],
  )

  const ai = useAiPicks<TvRecommendation>('show', tmdbConfigured && !loading && (lists !== null || !hasLiked), async () => {
    const pool = new Map<number, Pooled<TvRecommendation>>()
    const add = (r: TvRecommendation & Partial<TvRec>, tag?: string) => {
      if (hidden(r)) return
      const prev = pool.get(r.id)
      if (prev) {
        if (tag && !prev.cand.tag) prev.cand.tag = tag
        return
      }
      pool.set(r.id, {
        item: { id: r.id, name: r.name, originalName: r.originalName, poster_url: r.poster_url, year: r.year },
        cand: {
          id: r.id, title: r.name, originalTitle: r.originalName, year: r.year,
          genreIds: r.genreIds ?? [], overview: r.overview, vote: r.vote, tag,
        },
      })
    }
    const top = await realNetflixTop10Shows().catch(() => null)
    top?.entries.forEach((e) => e.match && add(e.match, `Top 10 Netflix n°${e.rank}`))
    ranked.forEach((r) => add(r.item))
    ;(await discoverRecentShows()).forEach((r) => add(r))
    return [...pool.values()].slice(0, 100)
  })

  const aiVisible = (ai.result?.picks ?? []).filter((p) => !hidden(p.item))
  const fallback = ranked.slice(0, 20)
  if (!tmdbConfigured || (!aiVisible.length && !fallback.length && !ai.generating)) return null

  return (
    <RecommendedSection ai={ai}>
      {aiVisible.length > 0 ? (
        <ul className="shelf shelf--carousel shelf--cards">
          {aiVisible.map(({ item: r, reason, tag }) => (
            <li key={r.id} className="shelf__item">
              <button type="button" className="aicard" onClick={() => opener.open(r)} disabled={opener.opening === r.id}>
                <AiCardBody
                  poster={r.poster_url}
                  title={r.name}
                  reason={reason}
                  tag={tag}
                  status={
                    opener.opening === r.id ? 'Ouverture…' : opener.notFound === r.id ? 'Introuvable chez TVmaze' : undefined
                  }
                />
              </button>
              <Dismiss label={r.name} onClick={() => dismissRec('show', r.id, r.name, r.poster_url)} />
            </li>
          ))}
        </ul>
      ) : fallback.length > 0 ? (
        <ul className="shelf shelf--carousel">
          {fallback.map(({ item: r, because }) => (
            <ShowTile
              key={r.id}
              r={r}
              note={`Comme ${because}`}
              opener={opener}
              onSkip={() => dismissRec('show', r.id, r.name, r.poster_url)}
            />
          ))}
        </ul>
      ) : null}
    </RecommendedSection>
  )
}
