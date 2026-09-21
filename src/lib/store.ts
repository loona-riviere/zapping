import { supabase } from './supabase'
import type { Movie } from './tmdb'
import type { TvEpisode, TvShow } from './tvmaze'

/** Statut de suivi d'une série. */
export type ShowStatus = 'watching' | 'paused' | 'later' | 'dropped'

export const STATUS_LABEL: Record<ShowStatus, string> = {
  watching: 'En cours',
  paused: 'En pause',
  later: 'À regarder plus tard',
  dropped: 'Abandonnée',
}

export const STATUSES = Object.keys(STATUS_LABEL) as ShowStatus[]

export type TrackedShow = {
  show_id: number
  name: string
  image_url: string | null
  added_at: string
  last_watched_at: string | null
  status: ShowStatus
}

export type WatchedMovie = {
  movie_id: number
  title: string
  poster_url: string | null
  release_year: number | null
  /** Null quand la date de visionnage est inconnue. */
  watched_at: string | null
  /** Durée en minutes, null tant qu'elle n'a pas été relevée chez TMDB. */
  runtime: number | null
}

/**
 * Pour chaque série, ses épisodes vus et la date à laquelle ils l'ont été.
 * La date vaut null quand elle est inconnue (reprise sans date fournie).
 */
export type WatchedMap = Map<number, Map<number, string | null>>

const PAGE = 1000

/**
 * La table ou la colonne n'existe pas encore : `supabase/schema.sql` n'a pas été
 * relancé depuis la mise à jour. On veut le détecter pour continuer à servir ce
 * qui marche plutôt que de tout faire échouer.
 */
export function isMissingSchema(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null
  if (!e) return false
  if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(e.code ?? '')) return true
  return /schema cache|does not exist|column .* does not exist/i.test(e.message ?? '')
}

const LEGACY_COLUMNS = 'show_id, name, image_url, added_at, last_watched_at'

export async function fetchTracked(): Promise<TrackedShow[]> {
  const full = await supabase.from('tracked_shows').select(`${LEGACY_COLUMNS}, status`)
  if (!full.error) {
    return (full.data ?? []).map((r) => ({ ...r, status: (r.status ?? 'watching') as ShowStatus }))
  }
  if (!isMissingSchema(full.error)) throw full.error

  // Schéma pas encore migré : on lit les colonnes d'origine, tout est « en cours ».
  const legacy = await supabase.from('tracked_shows').select(LEGACY_COLUMNS)
  if (legacy.error) throw legacy.error
  return (legacy.data ?? []).map((r) => ({ ...r, status: 'watching' as ShowStatus }))
}

export async function fetchWatched(): Promise<WatchedMap> {
  const map: WatchedMap = new Map()
  // Supabase renvoie 1000 lignes max par requête : on pagine.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('watched_episodes')
      .select('show_id, episode_id, watched_at')
      .order('episode_id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    for (const row of data ?? []) {
      let eps = map.get(row.show_id)
      if (!eps) map.set(row.show_id, (eps = new Map()))
      eps.set(row.episode_id, row.watched_at)
    }
    if (!data || data.length < PAGE) break
  }
  return map
}

export async function trackShow(userId: string, show: TvShow): Promise<TrackedShow> {
  const row = {
    user_id: userId,
    show_id: show.id,
    name: show.name,
    image_url: show.image?.medium ?? null,
  }
  const { error } = await supabase
    .from('tracked_shows')
    .upsert(row, { onConflict: 'user_id,show_id', ignoreDuplicates: true })
  if (error) throw error
  return {
    show_id: show.id,
    name: show.name,
    image_url: row.image_url,
    added_at: new Date().toISOString(),
    last_watched_at: null,
    status: 'watching',
  }
}

export async function untrackShow(showId: number): Promise<void> {
  const a = await supabase.from('watched_episodes').delete().eq('show_id', showId)
  if (a.error) throw a.error
  const b = await supabase.from('tracked_shows').delete().eq('show_id', showId)
  if (b.error) throw b.error
}

export async function setShowStatus(showId: number, status: ShowStatus): Promise<void> {
  const { error } = await supabase.from('tracked_shows').update({ status }).eq('show_id', showId)
  if (error) throw error
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * Coche des épisodes. `dates` permet de fournir la date de visionnage réelle
 * (import Netflix) ; sans elle, c'est maintenant.
 *
 * `overwrite` réécrit les lignes déjà présentes au lieu de les ignorer : c'est
 * ce qui permet de corriger après coup des dates fausses, quand une reprise en
 * masse antérieure avait horodaté à la date du jour.
 */
export async function markWatched(
  userId: string,
  showId: number,
  eps: TvEpisode[],
  dates?: Map<number, string | null>,
  overwrite = false,
): Promise<void> {
  if (!eps.length) return
  // Sans table de dates, c'est un clic dans l'app : la date est maintenant.
  // Avec une table, une entrée absente ou nulle signifie « date inconnue ».
  const now = new Date().toISOString()
  const rows = eps.map((e) => ({
    user_id: userId,
    episode_id: e.id,
    show_id: showId,
    season: e.season,
    number: e.number,
    watched_at: dates ? (dates.get(e.id) ?? null) : now,
  }))
  for (const batch of chunks(rows, 500)) {
    const { error } = await supabase
      .from('watched_episodes')
      .upsert(batch, { onConflict: 'user_id,episode_id', ignoreDuplicates: !overwrite })
    if (error) throw error
  }
  // Les épisodes sans date ne peuvent pas dater la série : si aucun n'est daté,
  // on laisse last_watched_at tel quel plutôt que d'inventer.
  const last = rows.reduce<string | null>(
    (max, r) => (r.watched_at && (!max || r.watched_at > max) ? r.watched_at : max),
    null,
  )
  if (!last) return
  const { error } = await supabase
    .from('tracked_shows')
    .update({ last_watched_at: last })
    .eq('show_id', showId)
  if (error) throw error
}

export async function markUnwatched(ids: number[]): Promise<void> {
  for (const batch of chunks(ids, 300)) {
    const { error } = await supabase.from('watched_episodes').delete().in('episode_id', batch)
    if (error) throw error
  }
}

/* ---------------------------------------------------------------- films --- */

export async function fetchMovies(): Promise<WatchedMovie[]> {
  const out: WatchedMovie[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('watched_movies')
      .select('movie_id, title, poster_url, release_year, watched_at, runtime')
      .order('watched_at', { ascending: false, nullsFirst: false })
      .range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return out
}

export function movieRow(
  userId: string,
  movie: Movie,
  watchedAt: string | null,
  runtime: number | null = null,
) {
  return {
    user_id: userId,
    movie_id: movie.id,
    title: movie.title,
    poster_url: movie.poster_url,
    release_year: movie.year,
    watched_at: watchedAt,
    runtime,
  }
}

export async function addMovies(
  userId: string,
  items: { movie: Movie; watchedAt: string | null; runtime?: number | null }[],
): Promise<void> {
  if (!items.length) return
  const rows = items.map((i) => movieRow(userId, i.movie, i.watchedAt, i.runtime ?? null))
  for (const batch of chunks(rows, 500)) {
    const { error } = await supabase
      .from('watched_movies')
      .upsert(batch, { onConflict: 'user_id,movie_id', ignoreDuplicates: true })
    if (error) throw error
  }
}

export async function removeMovie(movieId: number): Promise<void> {
  const { error } = await supabase.from('watched_movies').delete().eq('movie_id', movieId)
  if (error) throw error
}

/** Complète la durée de films déjà enregistrés, sans toucher au reste. */
export async function setMovieRuntimes(
  runtimes: { movie_id: number; runtime: number }[],
): Promise<void> {
  for (const { movie_id, runtime } of runtimes) {
    const { error } = await supabase
      .from('watched_movies')
      .update({ runtime })
      .eq('movie_id', movie_id)
    if (error) throw error
  }
}
