import { me, supabase } from './supabase'
import { nestedMapCodec, offlineCached } from './offline'
import { queueable } from './offlineQueue'
import type { Movie } from './tmdb'
import type { TvEpisode, TvShow } from './series'

/** Statut de suivi d'une série. */
export type ShowStatus = 'watching' | 'paused' | 'later' | 'dropped'

export const STATUS_LABEL: Record<ShowStatus, string> = {
  watching: 'Suivie',
  paused: 'En pause',
  later: 'À regarder plus tard',
  dropped: 'Abandonnée',
}

export const STATUSES = Object.keys(STATUS_LABEL) as ShowStatus[]

/** Notation façon Netflix : sert surtout à choisir de meilleures graines de recommandation. */
export type Rating = 'dislike' | 'like' | 'love'

/** Pour trier « ce qu'on a adoré » en premier : plus haut = à privilégier comme graine. */
export function ratingRank(r: Rating | null | undefined): number {
  return r === 'love' ? 2 : r === 'like' ? 1 : r === 'dislike' ? -1 : 0
}

export type TrackedShow = {
  show_id: number
  name: string
  image_url: string | null
  added_at: string
  last_watched_at: string | null
  status: ShowStatus
  /** Nombre de revisionnages complets, en plus du premier. */
  rewatches: number
  /** Vrai pendant un revisionnage : la progression est suivie à part. */
  rewatching: boolean
  rating: Rating | null
  /** Rang dans « à regarder plus tard », plus petit = plus envie ; absent = pas rangé. */
  wish_rank?: number | null
  /** Caché aux amis. */
  hidden?: boolean
  /** Revisionnages terminés, datés (le premier visionnage vit dans watched_episodes). */
  past_viewings?: Viewing[]
  /** Amis présents au premier visionnage (celui des épisodes cochés). */
  first_with?: string[]
}

export type Viewing = { started_at: string | null; finished_at: string | null; with?: string[] }

export type WatchedMovie = {
  movie_id: number
  title: string
  poster_url: string | null
  release_year: number | null
  /** Date de sortie complète ; absente pour les films ajoutés avant ce champ. */
  release_date: string | null
  /** Null quand la date de visionnage est inconnue. */
  watched_at: string | null
  /** Durée en minutes, null tant qu'elle n'a pas été relevée chez TMDB. */
  runtime: number | null
  /** « later » : ajouté à voir, pas encore vu. */
  status: 'watched' | 'later'
  rating: Rating | null
  /** Rang dans « à voir », plus petit = plus envie ; absent = pas rangé. */
  wish_rank?: number | null
  /** Caché aux amis. */
  hidden?: boolean
  /** Visionnages d'avant le plus récent (null = date inconnue). */
  past_views?: (string | null)[]
  /** Amis présents au visionnage le plus récent. */
  watched_with?: string[]
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

async function fetchTrackedRemote(): Promise<TrackedShow[]> {
  const uid = await me()
  const full = await supabase
    .from('tracked_shows')
    // `*` : une colonne ajoutée depuis (past_viewings…) qui manquerait encore
    // en base est juste absente des lignes.
    .select('*')
    .eq('user_id', uid)
  if (!full.error) {
    return (full.data ?? []).map((r) => ({
      ...r,
      status: (r.status ?? 'watching') as ShowStatus,
      rewatches: r.rewatches ?? 0,
      rewatching: r.rewatching ?? false,
      rating: (r.rating ?? null) as Rating | null,
      hidden: r.hidden ?? false,
    }))
  }
  if (!isMissingSchema(full.error)) throw full.error

  // Schéma pas encore migré : on lit les colonnes d'origine, tout est « en cours ».
  // Sans « hidden » d'abord (schéma des amis pas encore passé), puis sans rien.
  const noHidden = await supabase
    .from('tracked_shows')
    .select(`${LEGACY_COLUMNS}, status, rewatches, rewatching, rating`)
    .eq('user_id', uid)
  if (!noHidden.error) {
    return (noHidden.data ?? []).map((r) => ({
      ...r,
      status: (r.status ?? 'watching') as ShowStatus,
      rewatches: r.rewatches ?? 0,
      rewatching: r.rewatching ?? false,
      rating: (r.rating ?? null) as Rating | null,
    }))
  }
  const legacy = await supabase.from('tracked_shows').select(LEGACY_COLUMNS).eq('user_id', uid)
  if (legacy.error) throw legacy.error
  return (legacy.data ?? []).map((r) => ({
    ...r,
    status: 'watching' as ShowStatus,
    rewatches: 0,
    rewatching: false,
    rating: null,
  }))
}

async function fetchWatchedRemote(): Promise<WatchedMap> {
  const map: WatchedMap = new Map()
  const uid = await me()
  // Supabase renvoie 1000 lignes max par requête : on pagine.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('watched_episodes')
      .select('show_id, episode_id, watched_at')
      .eq('user_id', uid)
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
  // Tant qu'aucun épisode n'est coché, la série est « à voir », pas « en
  // cours » : on ne l'a pas encore commencée.
  const row = {
    user_id: userId,
    show_id: show.id,
    name: show.name,
    image_url: show.image?.medium ?? null,
    status: 'later' as ShowStatus,
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
    status: 'later',
    rewatches: 0,
    rewatching: false,
    rating: null,
  }
}

export async function untrackShow(showId: number): Promise<void> {
  const a = await supabase.from('watched_episodes').delete().eq('show_id', showId)
  if (a.error) throw a.error
  const b = await supabase.from('tracked_shows').delete().eq('show_id', showId)
  if (b.error) throw b.error
}

export async function setRewatches(showId: number, rewatches: number): Promise<void> {
  const { error } = await supabase
    .from('tracked_shows')
    .update({ rewatches })
    .eq('show_id', showId)
  if (error) throw error
}

/** « Vu avec » : premier visionnage d'une série, ou dernier visionnage d'un film. */
export async function setShowFirstWith(showId: number, ids: string[]): Promise<void> {
  const { error } = await supabase.from('tracked_shows').update({ first_with: ids }).eq('show_id', showId).eq('user_id', await me())
  if (error) throw error
}
export async function setMovieWith(movieId: number, ids: string[]): Promise<void> {
  const { error } = await supabase.from('watched_movies').update({ watched_with: ids }).eq('movie_id', movieId).eq('user_id', await me())
  if (error) throw error
}

/** Revisionnages terminés : leurs dates et leur nombre, écrits ensemble. */
export async function setShowViewings(showId: number, past: Viewing[], rewatches: number): Promise<void> {
  const { error } = await supabase
    .from('tracked_shows')
    .update({ past_viewings: past, rewatches })
    .eq('show_id', showId)
    .eq('user_id', await me())
  if (error) throw error
}

async function setShowStatusNow(showId: number, status: ShowStatus): Promise<void> {
  const { error } = await supabase.from('tracked_shows').update({ status }).eq('show_id', showId)
  if (error) throw error
}

/** Note une série suivie ; `null` retire la note. */
async function rateShowNow(showId: number, rating: Rating | null): Promise<void> {
  const { error } = await supabase.from('tracked_shows').update({ rating }).eq('show_id', showId)
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
async function markWatchedNow(
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
  // Recalcule last_watched_at à partir de toutes les dates connues en base,
  // pas seulement celles de ce lot : une correction en masse (« Dater à la
  // diffusion ») peut aussi bien avancer que reculer la date la plus récente.
  const { error } = await supabase.rpc('sync_last_watched', { p_show_id: showId })
  if (error) throw error
}

async function markUnwatchedNow(ids: number[]): Promise<void> {
  for (const batch of chunks(ids, 300)) {
    const { error } = await supabase.from('watched_episodes').delete().in('episode_id', batch)
    if (error) throw error
  }
}

/* ---------------------------------------------------------------- films --- */

async function fetchMoviesRemote(): Promise<WatchedMovie[]> {
  const out: WatchedMovie[] = []
  const uid = await me()
  // `*` plutôt qu'une liste de colonnes : si `status` n'existe pas encore
  // (schema.sql pas relancé), elle est juste absente des lignes plutôt que de
  // faire échouer toute la requête, et on retombe alors sur « vu ».
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('watched_movies')
      // `*` : une colonne ajoutée depuis (hidden, wish_rank) qui manquerait
      // encore en base est juste absente des lignes.
      .select('*')
      .eq('user_id', uid)
      .order('watched_at', { ascending: false, nullsFirst: false })
      .range(from, from + PAGE - 1)
    if (error) {
      if (!isMissingSchema(error)) throw error
      return fetchMoviesLegacy()
    }
    out.push(...(data ?? []).map((r) => ({ ...r, status: r.status ?? 'watched', rating: r.rating ?? null }) as WatchedMovie))
    if (!data || data.length < PAGE) break
  }
  return out
}

/** Schéma pas encore migré : pas de colonne `status`, tout est « vu ». */
async function fetchMoviesLegacy(): Promise<WatchedMovie[]> {
  const out: WatchedMovie[] = []
  const uid = await me()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('watched_movies')
      .select('movie_id, title, poster_url, release_year, watched_at, runtime')
      .eq('user_id', uid)
      .order('watched_at', { ascending: false, nullsFirst: false })
      .range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...(data ?? []).map((r) => ({ ...r, release_date: null, status: 'watched' as const, rating: null })))
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
    release_date: movie.release_date,
    watched_at: watchedAt,
    runtime,
    status: 'watched' as const,
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

/** Ajoute un film à voir, sans date : il n'est pas encore vu. */
export async function addToWatchlist(userId: string, movie: Movie): Promise<void> {
  const row = {
    user_id: userId,
    movie_id: movie.id,
    title: movie.title,
    poster_url: movie.poster_url,
    release_year: movie.year,
    release_date: movie.release_date,
    watched_at: null,
    runtime: null,
    status: 'later' as const,
  }
  const { error } = await supabase
    .from('watched_movies')
    .upsert(row, { onConflict: 'user_id,movie_id', ignoreDuplicates: true })
  if (error) throw error
}

/** Bascule un film « à voir » sur « vu », à la date donnée (ou inconnue). */
async function markMovieWatchedNow(movieId: number, watchedAt: string | null): Promise<void> {
  const { error } = await supabase
    .from('watched_movies')
    .update({ status: 'watched', watched_at: watchedAt })
    .eq('movie_id', movieId)
  if (error) throw error
}

/** Revoir : le visionnage courant rejoint ceux d'avant, le nouveau prend sa place. */
async function setMovieViewsNow(movieId: number, watchedAt: string | null, pastViews: (string | null)[]): Promise<void> {
  const { error } = await supabase
    .from('watched_movies')
    .update({ status: 'watched', watched_at: watchedAt, past_views: pastViews })
    .eq('movie_id', movieId)
    .eq('user_id', await me())
  if (error) throw error
}

/** « Vu ensemble » : marque le film vu chez un ami aussi, à la même date. */
export async function shareMovieViewing(friendId: string, m: WatchedMovie): Promise<void> {
  const { error } = await supabase.rpc('share_movie_viewing', {
    p_friend: friendId,
    p_movie_id: m.movie_id,
    p_title: m.title,
    p_poster: m.poster_url,
    p_year: m.release_year,
    p_release: m.release_date,
    p_runtime: m.runtime,
    p_at: m.watched_at,
  })
  if (error) throw error
}

/** Annule un « vu » par erreur : retour à « à voir », sans perdre la fiche. */
async function markMovieUnwatchedNow(movieId: number): Promise<void> {
  const { error } = await supabase
    .from('watched_movies')
    .update({ status: 'later', watched_at: null })
    .eq('movie_id', movieId)
  if (error) throw error
}

/** Remet un film retiré tel qu'il était (annulation), note et date comprises. */
export async function restoreMovie(userId: string, movie: WatchedMovie): Promise<void> {
  // Sans rang, on n'envoie pas la colonne : elle peut manquer si le schéma n'a pas été relancé.
  const { wish_rank, hidden, ...rest } = movie
  const row = { ...rest, ...(wish_rank != null ? { wish_rank } : {}), ...(hidden ? { hidden } : {}) }
  const { error } = await supabase
    .from('watched_movies')
    .upsert({ ...row, user_id: userId }, { onConflict: 'user_id,movie_id' })
  if (error) throw error
}

export async function removeMovie(movieId: number): Promise<void> {
  const { error } = await supabase.from('watched_movies').delete().eq('movie_id', movieId)
  if (error) throw error
}

/** Note un film vu ; `null` retire la note. */
async function rateMovieNow(movieId: number, rating: Rating | null): Promise<void> {
  const { error } = await supabase.from('watched_movies').update({ rating }).eq('movie_id', movieId)
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

/**
 * Complète l'affiche et/ou la durée d'un film à partir de ce que sa fiche
 * détail vient de trouver chez TMDB — utile pour les films ajoutés sans
 * passer par l'app (import direct en base) qui n'ont jamais eu droit à cet
 * enrichissement.
 */
export async function fillMovieMeta(
  movieId: number,
  patch: { poster_url?: string; runtime?: number; release_date?: string },
): Promise<void> {
  const { error } = await supabase.from('watched_movies').update(patch).eq('movie_id', movieId)
  if (error) throw error
}

/* --------------------------------------------------- revisionnage en cours -- */

async function fetchRewatchProgressRemote(): Promise<WatchedMap> {
  const map: WatchedMap = new Map()
  const uid = await me()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('rewatch_progress')
      .select('show_id, episode_id, watched_at')
      .eq('user_id', uid)
      .order('episode_id')
      .range(from, from + PAGE - 1)
    if (error) {
      // Table absente : le schéma n'a pas été migré, on continue sans.
      if (isMissingSchema(error)) return map
      throw error
    }
    for (const row of data ?? []) {
      let eps = map.get(row.show_id)
      if (!eps) map.set(row.show_id, (eps = new Map()))
      eps.set(row.episode_id, row.watched_at)
    }
    if (!data || data.length < PAGE) break
  }
  return map
}

export async function setRewatching(showId: number, rewatching: boolean): Promise<void> {
  const { error } = await supabase
    .from('tracked_shows')
    .update({ rewatching })
    .eq('show_id', showId)
  if (error) throw error
}

export async function clearRewatchProgress(showId: number): Promise<void> {
  const { error } = await supabase.from('rewatch_progress').delete().eq('show_id', showId)
  if (error) throw error
}

async function markRewatchedNow(
  userId: string,
  showId: number,
  eps: TvEpisode[],
  dates?: Map<number, string | null>,
  overwrite = false,
): Promise<void> {
  if (!eps.length) return
  const now = new Date().toISOString()
  const rows = eps.map((e) => ({
    user_id: userId,
    show_id: showId,
    episode_id: e.id,
    watched_at: dates ? (dates.get(e.id) ?? null) : now,
  }))
  for (const batch of chunks(rows, 500)) {
    const { error } = await supabase
      .from('rewatch_progress')
      .upsert(batch, { onConflict: 'user_id,episode_id', ignoreDuplicates: !overwrite })
    if (error) throw error
  }
  // touchLastWatched est appelé par l'appelant (appState), qui recalcule la
  // vraie date à partir de l'ensemble de la passe en cours plutôt que de
  // toujours poser « maintenant » — utile pour corriger une date après coup.
}

/** Fixe la date d'activité d'une série pour le tri de l'accueil ; null s'il n'en reste aucune. */
async function touchLastWatchedNow(showId: number, at: string | null): Promise<void> {
  const { error } = await supabase.from('tracked_shows').update({ last_watched_at: at }).eq('show_id', showId)
  if (error) throw error
}

/** Renomme une série suivie — sert à poser le titre français une fois trouvé chez TMDB. */
export async function renameShow(showId: number, name: string): Promise<void> {
  const { error } = await supabase.from('tracked_shows').update({ name }).eq('show_id', showId)
  if (error) throw error
}

async function unmarkRewatchedNow(ids: number[]): Promise<void> {
  for (const batch of chunks(ids, 300)) {
    const { error } = await supabase.from('rewatch_progress').delete().in('episode_id', batch)
    if (error) throw error
  }
}

export type DismissedRec = {
  kind: 'show' | 'movie'
  tmdb_id: number
  name: string
  poster_url: string | null
  dismissed_at: string
}

export async function fetchDismissed(): Promise<DismissedRec[]> {
  const { data, error } = await supabase
    .from('dismissed_recommendations')
    .select('kind, tmdb_id, name, poster_url, dismissed_at')
    .eq('user_id', await me())
    .order('dismissed_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as DismissedRec[]
}

export async function dismissRec(kind: 'show' | 'movie', id: number, name: string, posterUrl: string | null): Promise<void> {
  const { error } = await supabase
    .from('dismissed_recommendations')
    .upsert({ kind, tmdb_id: id, name, poster_url: posterUrl }, { onConflict: 'user_id,kind,tmdb_id' })
  if (error) throw error
}

export async function undismissRec(kind: 'show' | 'movie', id: number): Promise<void> {
  const { error } = await supabase
    .from('dismissed_recommendations')
    .delete()
    .eq('kind', kind)
    .eq('tmdb_id', id)
  if (error) throw error
}

/* ------------------------------------------------------- ordre d'envie --- */

type RankTable = 'tracked_shows' | 'watched_movies' | 'tracked_books'
const RANK_ID: Record<RankTable, string> = {
  tracked_shows: 'show_id',
  watched_movies: 'movie_id',
  tracked_books: 'book_id',
}

/**
 * Rangs d'envie déjà posés, lus à part des listes elles-mêmes : si la
 * colonne manque (schéma pas relancé), tout le reste se charge normalement
 * et seul le rangement est indisponible — `null` le signale.
 */
export async function fetchRanks(table: RankTable): Promise<Map<string | number, number> | null> {
  const id = RANK_ID[table]
  const { data, error } = await supabase
    .from(table)
    .select(`${id}, wish_rank`)
    .eq('user_id', await me())
    .not('wish_rank', 'is', null)
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  const rows = (data ?? []) as unknown as Record<string, string | number>[]
  return new Map(rows.map((r) => [r[id], Number(r.wish_rank)]))
}

/** Enregistre un nouvel ordre : une mise à jour par ligne dont le rang a changé. */
export async function saveRanks(table: RankTable, ranks: { id: string | number; rank: number }[]): Promise<void> {
  const id = RANK_ID[table]
  const results = await Promise.all(
    ranks.map((r) => supabase.from(table).update({ wish_rank: r.rank }).eq(id, r.id)),
  )
  const failed = results.find((r) => r.error)
  if (failed?.error) throw failed.error
}

/**
 * Nouveaux rangs 1, 2, 3… pour une liste dans l'ordre voulu, en ne gardant
 * que ceux qui changent : déplacer un élément ne réécrit que ce qui a bougé.
 */
export function rerank<T>(ordered: T[], idOf: (t: T) => string | number, rankOf: (t: T) => number | null | undefined) {
  return ordered
    .map((t, i) => ({ id: idOf(t), rank: i + 1, before: rankOf(t) }))
    .filter((r) => r.before !== r.rank)
    .map(({ id, rank }) => ({ id, rank }))
}

/** Tri d'une liste d'envie : les rangés d'abord, par rang ; les autres ensuite, dans l'ordre reçu. */
export function byWish<T extends { wish_rank?: number | null }>(items: T[]): T[] {
  return items
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const ra = a.t.wish_rank ?? Infinity
      const rb = b.t.wish_rank ?? Infinity
      return ra === rb ? a.i - b.i : ra - rb
    })
    .map((x) => x.t)
}

/* Chargements servis depuis la dernière copie de l'appareil quand le réseau manque. */
export const fetchTracked = () => offlineCached('tracked', fetchTrackedRemote)
export const fetchWatched = () => offlineCached('watched', fetchWatchedRemote, nestedMapCodec)
export const fetchRewatchProgress = () => offlineCached('rewatch', fetchRewatchProgressRemote, nestedMapCodec)
export const fetchMovies = () => offlineCached('movies', fetchMoviesRemote)

/* Écritures courantes : sans réseau, mises en file et rejouées au retour du réseau. */
type MarkArgs = [userId: string, showId: number, eps: TvEpisode[], dates?: Map<number, string | null>, overwrite?: boolean]
const withDates = {
  save: ([u, s, eps, d, o]: MarkArgs) => [u, s, eps, d ? [...d.entries()] : null, o],
  restore: (raw: unknown): MarkArgs => {
    const [u, s, eps, d, o] = raw as [string, number, TvEpisode[], [number, string | null][] | null, boolean | undefined]
    return [u, s, eps, d ? new Map(d) : undefined, o]
  },
}
export const markWatched = queueable('markWatched', markWatchedNow, withDates)
export const markRewatched = queueable('markRewatched', markRewatchedNow, withDates)
export const markUnwatched = queueable('markUnwatched', markUnwatchedNow)
export const unmarkRewatched = queueable('unmarkRewatched', unmarkRewatchedNow)
export const touchLastWatched = queueable('touchLastWatched', touchLastWatchedNow)
export const setShowStatus = queueable('setShowStatus', setShowStatusNow)
export const rateShow = queueable('rateShow', rateShowNow)
export const markMovieWatched = queueable('markMovieWatched', markMovieWatchedNow)
export const markMovieUnwatched = queueable('markMovieUnwatched', markMovieUnwatchedNow)
export const setMovieViews = queueable('setMovieViews', setMovieViewsNow)
export const rateMovie = queueable('rateMovie', rateMovieNow)
