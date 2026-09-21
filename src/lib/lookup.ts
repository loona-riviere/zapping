// Retrouver une œuvre au catalogue à partir d'un titre d'export ou d'une
// recherche. Isolé ici parce que les imports et l'écran Chercher en ont besoin.
//
// Le problème commun : Netflix et l'utilisatrice nomment les séries en
// français, TVmaze n'indexe que le titre d'origine et ne connaît qu'une partie
// des alias. TMDB, lui, est localisé : il sert de dictionnaire.

import { originalTitlesFor, searchMovies, tmdbConfigured, type Movie } from './tmdb'
import { getShowWithEpisodes, searchShows, type ShowWithEpisodes, type TvShow } from './tvmaze'

export type FoundShow = ShowWithEpisodes & {
  /** Titre par lequel la série a été retrouvée, s'il diffère du titre demandé. */
  via?: string
}

/** `tried` liste les titres originaux proposés par TMDB, pour expliquer un échec. */
export type ShowLookup = { show: FoundShow | null; tried: string[] }

export type WideSearch = { results: TvShow[]; via?: string; tried: string[] }

/**
 * Recherche de séries élargie : TVmaze sur le titre tel quel, puis, s'il ne
 * connaît pas, sur les titres originaux que TMDB associe à ce titre français.
 */
export async function searchShowsWide(query: string): Promise<WideSearch> {
  const direct = await searchShows(query)
  if (direct.length || !tmdbConfigured) return { results: direct, tried: [] }

  const tried = await originalTitlesFor(query)
  for (const candidate of tried.slice(0, 3)) {
    const hits = await searchShows(candidate)
    if (hits.length) return { results: hits, via: candidate, tried }
  }
  return { results: [], tried }
}

type Candidate = { data: ShowWithEpisodes; enough: boolean }

/**
 * Le premier résultat TVmaze n'est pas toujours le bon : « Good Doctor » renvoie
 * la série coréenne (20 épisodes) alors que l'export en compte 65, donc c'est la
 * version américaine qui était regardée. Quand on sait combien d'épisodes ont été
 * vus, on descend dans les résultats jusqu'à en trouver un d'au moins cette
 * taille ; sinon on garde le premier.
 */
async function firstFitting(results: TvShow[], minEpisodes: number): Promise<Candidate | null> {
  if (!results.length) return null
  // Chaque candidat coûte une requête : on n'en sonde plusieurs que si le
  // premier est manifestement trop court.
  const probe = minEpisodes > 0 ? results.slice(0, 3) : results.slice(0, 1)
  let fallback: ShowWithEpisodes | null = null
  for (const r of probe) {
    const data = await getShowWithEpisodes(r.id)
    if (data.episodes.length >= minEpisodes) return { data, enough: true }
    if (!fallback) fallback = data
  }
  return fallback ? { data: fallback, enough: false } : null
}

export async function findShow(
  title: string,
  opts: { minEpisodes?: number } = {},
): Promise<ShowLookup> {
  const min = opts.minEpisodes ?? 0

  const direct = await firstFitting(await searchShows(title), min)
  if (direct?.enough) return { show: direct.data, tried: [] }
  if (!tmdbConfigured) return { show: direct?.data ?? null, tried: [] }

  const tried = await originalTitlesFor(title)
  for (const candidate of tried.slice(0, 3)) {
    const hit = await firstFitting(await searchShows(candidate), min)
    if (hit?.enough) return { show: { ...hit.data, via: candidate }, tried }
    if (hit && !direct) return { show: { ...hit.data, via: candidate }, tried }
  }
  return { show: direct?.data ?? null, tried }
}

export type FoundMovie = { movie: Movie; via?: string }

/**
 * Netflix accole souvent un sous-titre au titre du film (« Love Again : un peu,
 * beaucoup, passionnément »), que TMDB n'indexe pas tel quel. Quand la recherche
 * complète ne donne rien, on réessaie sur la partie avant le deux-points.
 *
 * C'est un raccourci qui peut se tromper — « Bureau des cœurs: Amour fruité »
 * est un épisode de série, pas un film — d'où le `via` renvoyé, que l'écran de
 * relecture affiche pour rendre le rapprochement visible.
 */
export async function findMovie(title: string): Promise<FoundMovie | null> {
  if (!tmdbConfigured) return null

  const direct = await searchMovies(title)
  if (direct.length) return { movie: direct[0] }

  const head = title.split(/\s*:\s*/)[0].trim()
  if (!head || head === title) return null
  const hits = await searchMovies(head)
  return hits.length ? { movie: hits[0], via: head } : null
}

/** Phrase d'échec qui dit ce qui a été tenté, pour que l'utilisatrice puisse juger. */
export function explainMiss(tried: string[], kind: 'show' | 'movie'): string {
  const where = kind === 'movie' ? 'parmi les films' : 'au catalogue des séries'
  if (!tmdbConfigured) {
    return `Introuvable ${where} — essaie le titre original.`
  }
  if (!tried.length) {
    return `Introuvable ${where}, et TMDB ne connaît aucune série sous ce titre. Vérifie l'orthographe, ou cherche l'œuvre sur themoviedb.org pour trouver son titre d'origine.`
  }
  const list = tried.slice(0, 3).map((t) => `« ${t} »`).join(', ')
  return `Introuvable ${where}. TMDB propose ${list}, que TVmaze ne connaît pas non plus.`
}
