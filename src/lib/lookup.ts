// Trouver une série au catalogue à partir d'un titre d'export (Netflix, liste
// collée). Isolé ici parce que les deux écrans d'import en ont besoin.

import { originalTitlesFor, tmdbConfigured } from './tmdb'
import { getShowWithEpisodes, searchShows, type ShowWithEpisodes, type TvShow } from './tvmaze'

export type FoundShow = ShowWithEpisodes & {
  /** Titre par lequel la série a été retrouvée, s'il diffère du titre demandé. */
  via?: string
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

/**
 * TVmaze d'abord, sur le titre tel quel. S'il ne connaît pas — ou ne propose
 * qu'une série trop courte — on demande à TMDB les titres originaux
 * correspondants et on réessaie avec. C'est ce qui rattrape les séries que
 * Netflix a renommées en français (« Mercredi » pour « Wednesday »).
 */
export async function findShow(
  title: string,
  opts: { minEpisodes?: number } = {},
): Promise<FoundShow | null> {
  const min = opts.minEpisodes ?? 0

  const direct = await firstFitting(await searchShows(title), min)
  if (direct?.enough) return direct.data
  if (!tmdbConfigured) return direct?.data ?? null

  for (const candidate of (await originalTitlesFor(title)).slice(0, 3)) {
    const hit = await firstFitting(await searchShows(candidate), min)
    if (hit?.enough) return { ...hit.data, via: candidate }
    if (hit && !direct) return { ...hit.data, via: candidate }
  }
  return direct?.data ?? null
}
