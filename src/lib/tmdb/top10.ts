// Top 10 Netflix France, rapproché des fiches TMDB.
import { type Movie, type RawMovie, KEY, toMovie, get, readCache, writeCache, normalizeTitle } from './client'
import { toTvRec, type RawTvRec, type TvRecommendation } from './recommendations'

type Top10Row = { title: string; rank: number; weeks: number }
type Top10Data = { week: string; movies: Top10Row[]; shows: Top10Row[] }

/**
 * Une ligne du classement officiel. `match` est la fiche TMDB trouvée pour
 * ce titre, ou null si aucune ne correspond avec certitude : la ligne reste
 * affichée (un Top 10 à trous n'a pas l'air d'un Top 10), sans affiche.
 */
export type Top10Entry<T> = { title: string; rank: number; weeks: number; match: T | null }
export type Top10<T> = { week: string; entries: Top10Entry<T>[] }

/** Classement officiel Netflix France de la dernière semaine, via une fonction Netlify. */
async function fetchTop10Raw(): Promise<Top10Data | null> {
  // v4 : dernière semaine seule (v3 cumulait le mois).
  const key = 'zapping:top10:raw:v4'
  const hit = readCache<Top10Data>(key, 6 * 60 * 60 * 1000)
  if (hit) return hit
  try {
    const res = await fetch('/.netlify/functions/netflix-top10')
    if (!res.ok) return null
    const data = (await res.json()) as Top10Data | { error: string }
    if ('error' in data || !Array.isArray(data.movies)) return null
    writeCache(key, data)
    return data
  } catch {
    return null
  }
}

const norm = (s: string) => normalizeTitle(s.replace(/&/g, ' and ')).replace(/^(the|a|an|le|la|les|l) /, '')

type MatchCandidate = { id: number; titles: string[]; year: number | null; popularity: number; voteCount: number }

/**
 * Choisit la fiche TMDB qui correspond à un titre du classement Netflix.
 * Prendre le premier résultat de recherche, comme avant, tombait parfois sur
 * un tout autre film au nom proche (d'où de vieux films d'auteur affichés
 * dans le « Top 10 ») : on exige ici un titre identique — français, anglais
 * ou original — et on départage par récence et popularité. Pas de titre
 * identique → rien, plutôt qu'une fiche fausse.
 */
function pickMatch(title: string, candidates: MatchCandidate[]): number | null {
  const target = norm(title)
  if (!target) return null
  const thisYear = new Date().getFullYear()
  let best: { id: number; score: number } | null = null
  for (const c of candidates) {
    const names = c.titles.map(norm)
    const exact = names.includes(target)
    // Tolère un sous-titre (« Mission: Impossible – Dead Reckoning » vs
    // « Mission: Impossible »), mais seulement s'il reste un vrai mot commun.
    // Réservé aux sorties récentes : un vieux film au titre simplement proche
    // est exactement l'erreur qu'on veut éviter.
    const age = c.year ? thisYear - c.year : 30
    const partial =
      !exact &&
      age <= 3 &&
      target.length >= 4 &&
      names.some((n) => n.startsWith(target + ' ') || target.startsWith(n + ' '))
    if (!exact && !partial) continue
    const score =
      (exact ? 100 : 40) +
      (age <= 1 ? 25 : age <= 3 ? 15 : age <= 8 ? 5 : 0) +
      Math.log10(1 + c.popularity) * 10 +
      (c.voteCount < 10 ? -15 : 0)
    if (!best || score > best.score) best = { id: c.id, score }
  }
  return best?.id ?? null
}

const MATCH_TTL = 30 * 24 * 60 * 60 * 1000 // 30 j : un titre du classement désigne toujours la même fiche
// Titre sans correspondance : retenté le lendemain, TMDB ajoute vite les sorties récentes.
const MISS_TTL = 24 * 60 * 60 * 1000

async function matchTop10Movie(title: string): Promise<Movie | null> {
  const key = `tmdb:top10match:v1:movie:${norm(title)}`
  const missKey = `tmdb:top10miss:v1:movie:${norm(title)}`
  const hit = readCache<Movie>(key, MATCH_TTL)
  if (hit) return hit
  if (readCache<true>(missKey, MISS_TTL)) return null
  // Netflix publie le titre international (souvent anglais) : on cherche en
  // français ET en anglais pour comparer aux deux, l'affichage reste français.
  const [fr, en] = await Promise.all([
    get<{ results: RawMovie[] }>('/search/movie', { query: title, include_adult: 'false' }),
    get<{ results: RawMovie[] }>('/search/movie', { query: title, include_adult: 'false', language: 'en-US' }),
  ])
  const byId = new Map<number, MatchCandidate>()
  for (const r of [...fr.results, ...en.results]) {
    const c = byId.get(r.id) ?? {
      id: r.id,
      titles: [],
      year: r.release_date ? Number(r.release_date.slice(0, 4)) : null,
      popularity: r.popularity ?? 0,
      voteCount: r.vote_count ?? 0,
    }
    c.titles.push(r.title, r.original_title ?? '')
    byId.set(r.id, c)
  }
  const id = pickMatch(title, [...byId.values()])
  const raw = id === null ? undefined : fr.results.find((r) => r.id === id) ?? en.results.find((r) => r.id === id)
  const movie = raw ? toMovie(raw) : null
  if (movie) writeCache(key, movie)
  else writeCache(missKey, true)
  return movie
}

async function matchTop10Show(title: string): Promise<TvRecommendation | null> {
  const key = `tmdb:top10match:v1:show:${norm(title)}`
  const missKey = `tmdb:top10miss:v1:show:${norm(title)}`
  const hit = readCache<TvRecommendation>(key, MATCH_TTL)
  if (hit) return hit
  if (readCache<true>(missKey, MISS_TTL)) return null
  const [fr, en] = await Promise.all([
    get<{ results: RawTvRec[] }>('/search/tv', { query: title, include_adult: 'false' }),
    get<{ results: RawTvRec[] }>('/search/tv', { query: title, include_adult: 'false', language: 'en-US' }),
  ])
  const byId = new Map<number, MatchCandidate>()
  for (const r of [...fr.results, ...en.results]) {
    const c = byId.get(r.id) ?? {
      id: r.id,
      titles: [],
      year: r.first_air_date ? Number(r.first_air_date.slice(0, 4)) : null,
      popularity: r.popularity ?? 0,
      voteCount: r.vote_count ?? 0,
    }
    c.titles.push(r.name, r.original_name)
    byId.set(r.id, c)
  }
  const id = pickMatch(title, [...byId.values()])
  const raw = id === null ? undefined : fr.results.find((r) => r.id === id) ?? en.results.find((r) => r.id === id)
  const show = raw ? toTvRec(raw) : null
  if (show) writeCache(key, show)
  else writeCache(missKey, true)
  return show
}

/**
 * Titre par titre, séquentiellement : une rafale de recherches a déjà fait
 * sauter la limite de débit TMDB. Chaque correspondance est gardée 30 jours,
 * donc d'une semaine à l'autre seuls les nouveaux entrants coûtent une requête.
 */
async function resolveTop10<T>(rows: Top10Row[], match: (title: string) => Promise<T | null>) {
  const out: Top10Entry<T>[] = []
  for (const row of rows) {
    out.push({ ...row, match: await match(row.title).catch(() => null) })
  }
  return out
}

export async function realNetflixTop10Movies(): Promise<Top10<Movie> | null> {
  if (!KEY) return null
  const raw = await fetchTop10Raw()
  if (!raw?.movies.length) return null
  return { week: raw.week, entries: await resolveTop10(raw.movies, matchTop10Movie) }
}

export async function realNetflixTop10Shows(): Promise<Top10<TvRecommendation> | null> {
  if (!KEY) return null
  const raw = await fetchTop10Raw()
  if (!raw?.shows.length) return null
  return { week: raw.week, entries: await resolveTop10(raw.shows, matchTop10Show) }
}

