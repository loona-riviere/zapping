// Séries chez TMDB : identifiant à partir d'IMDb, titres originaux, textes en français.
import { KEY, get, readCache, writeCache, normalizeTitle } from './client'

/** Identifiant TMDB d'une série à partir de son IMDb ID — le lien ne change jamais, cache long. */
export async function resolveTvId(imdbId: string): Promise<number | null> {
  // v2 : les échecs ne sont plus mis en cache (voir plus bas), donc une
  // entrée v1 restée bloquée sur « null » doit être abandonnée.
  const key = `tmdb:tvid:v2:${imdbId}`
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) return raw === 'null' ? null : Number(raw)
  } catch {
    /* cache illisible : on refetch */
  }
  const found = await get<{ tv_results: { id: number }[] }>(`/find/${encodeURIComponent(imdbId)}`, {
    external_source: 'imdb_id',
  })
  const tvId = found.tv_results?.[0]?.id ?? null
  // On ne met en cache qu'une résolution réussie : un échec (raté TMDB
  // passager, série pas encore indexée) ne doit pas bloquer les tentatives
  // suivantes pour de bon.
  if (tvId !== null) {
    try {
      localStorage.setItem(key, String(tvId))
    } catch {
      /* stockage plein : pas grave */
    }
  }
  return tvId
}

type RawTv = { id: number; name: string; original_name: string; first_air_date: string | null }

/**
 * Titres originaux possibles d'une série cherchée par son titre français.
 *
 * Netflix nomme les séries dans la langue du compte (« À l'ombre des
 * magnolias ») alors que TVmaze n'indexe que le titre d'origine (« Sweet
 * Magnolias »). TMDB, lui, connaît les deux : on s'en sert de dictionnaire
 * pour retraduire avant d'interroger TVmaze.
 */
export async function originalTitlesFor(query: string): Promise<string[]> {
  if (!KEY) return []
  const data = await get<{ results: RawTv[] }>('/search/tv', { query, include_adult: 'false' })
  const seen = new Set([normalizeTitle(query)])
  const out: string[] = []
  for (const r of data.results.slice(0, 5)) {
    for (const candidate of [r.original_name, r.name]) {
      const key = normalizeTitle(candidate ?? '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(candidate)
    }
  }
  return out
}

const SUMMARY_TTL = 7 * 24 * 60 * 60 * 1000 // 7 j

/**
 * Résumé d'une série en français. TVmaze n'a que l'anglais ; on va chercher
 * la traduction chez TMDB via le pont IMDb. Retourne null sans série
 * d'IMDb ID, sans traduction connue, ou si TMDB est en pause (quota) — dans
 * tous les cas, l'appelant retombe alors sur le texte anglais de TVmaze.
 */
export type ShowDetailsFr = { name: string; overview: string | null }

/**
 * Titre et résumé français d'une série, via TMDB (résolue par son IMDb ID) —
 * TVmaze n'a que le titre original, pas de traduction. Les deux dans le même
 * appel : TMDB les renvoie ensemble, pas la peine de le faire deux fois.
 */
export async function showDetailsFr(imdbId: string | null | undefined): Promise<ShowDetailsFr | null> {
  if (!KEY || !imdbId) return null
  // Le numéro de version change avec la forme des données mises en cache
  // (leçon de movieDetails) : à rebumper si le type change encore.
  const key = `tmdb:showdetails:v1:${imdbId}`
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) {
      const cached = JSON.parse(raw) as { at: number; data: ShowDetailsFr | null }
      if (Date.now() - cached.at < SUMMARY_TTL) return cached.data
    }
  } catch {
    /* cache illisible : on refetch */
  }

  const tvId = await resolveTvId(imdbId)
  if (!tvId) return null
  const show = await get<{ name: string; overview: string | null }>(`/tv/${tvId}`, {})
  const data: ShowDetailsFr = { name: show.name, overview: show.overview || null }
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }))
  } catch {
    /* stockage plein : pas grave */
  }
  return data
}

/**
 * Résumés de tous les épisodes d'une saison, en français, par numéro
 * d'épisode — une seule requête TMDB couvre la saison entière. Même repli
 * que `showOverviewFr` en cas d'échec.
 */
export async function seasonOverviewsFr(
  imdbId: string | null | undefined,
  season: number,
): Promise<Map<number, string> | null> {
  if (!KEY || !imdbId) return null
  const key = `tmdb:season:${imdbId}:${season}`
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const cached = JSON.parse(raw) as { at: number; episodes: [number, string][] }
      if (Date.now() - cached.at < SUMMARY_TTL) return new Map(cached.episodes)
    }
  } catch {
    /* cache illisible : on refetch */
  }

  const tvId = await resolveTvId(imdbId)
  if (!tvId) return null
  const data = await get<{ episodes: { episode_number: number; overview: string | null }[] }>(
    `/tv/${tvId}/season/${season}`,
    {},
  )
  const episodes = new Map(
    data.episodes.filter((e) => e.overview).map((e) => [e.episode_number, e.overview as string]),
  )
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), episodes: [...episodes.entries()] }))
  } catch {
    /* stockage plein : pas grave */
  }
  return episodes
}

export type EpisodeFr = { name: string | null; overview: string | null; still: string | null }

/**
 * Titre, résumé et image de chaque épisode d'une saison, en français (TMDB),
 * pour la page d'un épisode. Une requête par saison, gardée comme les résumés.
 */
export async function seasonEpisodesFr(
  imdbId: string | null | undefined,
  season: number,
): Promise<Map<number, EpisodeFr> | null> {
  if (!KEY || !imdbId) return null
  const key = `tmdb:season-full:${imdbId}:${season}`
  const cached = readCache<[number, EpisodeFr][]>(key, SUMMARY_TTL)
  if (cached) return new Map(cached)
  const tvId = await resolveTvId(imdbId)
  if (!tvId) return null
  const data = await get<{
    episodes: { episode_number: number; name: string | null; overview: string | null; still_path: string | null }[]
  }>(`/tv/${tvId}/season/${season}`, {})
  const eps = new Map(
    data.episodes.map((e) => [
      e.episode_number,
      {
        // TMDB met « Épisode 3 » quand il n'a pas de titre traduit : autant garder celui de TVmaze.
        name: e.name && !/^(Épisode|Episode) \d+$/.test(e.name) ? e.name : null,
        overview: e.overview || null,
        still: e.still_path ? `https://image.tmdb.org/t/p/w780${e.still_path}` : null,
      },
    ]),
  )
  writeCache(key, [...eps.entries()])
  return eps
}

