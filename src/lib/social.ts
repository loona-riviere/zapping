// Amis : profils publics (pseudo), demandes d'amis et bibliothèques des amis
// en lecture seule. Les règles d'accès (supabase/schema.sql) font le vrai
// travail : un ami ne lit que ce qui n'est pas caché, et rien avant que la
// demande ait été acceptée.

import type { TrackedBook } from './bookStore'
import type { TrackedShow, WatchedMovie } from './store'
import { isMissingSchema } from './store'
import { me, supabase } from './supabase'

export type Profile = { user_id: string; username: string; display_name: string | null }

export type Friendship = {
  other: Profile
  status: 'pending' | 'accepted'
  /** Vrai si c'est moi qui ai envoyé la demande. */
  sentByMe: boolean
  created_at: string
}

/** Le nom à afficher : le nom choisi, sinon le pseudo. */
export const nameOf = (p: Pick<Profile, 'username' | 'display_name'>) => p.display_name?.trim() || p.username

/** Pseudo valide : 3 à 20 caractères, lettres minuscules, chiffres, point, tiret bas. */
export const USERNAME_RE = /^[a-z0-9_.]{3,20}$/

export function normalizeUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_.]/g, '')
}

/** null : pas encore de profil ; lève « missing » si le schéma des amis n'a pas été passé. */
export async function fetchMyProfile(): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, username, display_name')
    .eq('user_id', await me())
    .maybeSingle()
  if (error) throw error
  return data
}

export async function saveProfile(username: string, displayName: string): Promise<Profile> {
  const row = { user_id: await me(), username, display_name: displayName.trim() || null }
  const { error } = await supabase.from('profiles').upsert(row, { onConflict: 'user_id' })
  if (error) {
    if (error.code === '23505') throw new Error('Ce pseudo est déjà pris.')
    throw error
  }
  return row
}

export async function findProfile(username: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, username, display_name')
    .eq('username', normalizeUsername(username))
    .maybeSingle()
  if (error) throw error
  return data
}

/** Profils dont le pseudo commence par… (pas soi-même). */
export async function searchProfiles(prefix: string): Promise<Profile[]> {
  const q = normalizeUsername(prefix)
  if (q.length < 2) return []
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, username, display_name')
    .like('username', `${q.replace(/[%_]/g, (c) => `\\${c}`)}%`)
    .neq('user_id', await me())
    .order('username')
    .limit(10)
  if (error) throw error
  return data ?? []
}

export async function fetchFriendships(): Promise<Friendship[]> {
  const uid = await me()
  const { data, error } = await supabase
    .from('friendships')
    .select('requester, addressee, status, created_at')
  if (error) throw error
  const rows = (data ?? []) as { requester: string; addressee: string; status: 'pending' | 'accepted'; created_at: string }[]
  const otherIds = rows.map((r) => (r.requester === uid ? r.addressee : r.requester))
  if (!otherIds.length) return []
  const profiles = await supabase.from('profiles').select('user_id, username, display_name').in('user_id', otherIds)
  if (profiles.error) throw profiles.error
  const byId = new Map((profiles.data ?? []).map((p) => [p.user_id, p as Profile]))
  return rows
    .map((r) => {
      const otherId = r.requester === uid ? r.addressee : r.requester
      const other = byId.get(otherId)
      return other ? { other, status: r.status, sentByMe: r.requester === uid, created_at: r.created_at } : null
    })
    .filter((f): f is Friendship => !!f)
}

/**
 * Demande d'ami. Si l'autre m'a déjà fait une demande, l'envoyer revient à
 * l'accepter : deux demandes croisées ne doivent pas rester en attente.
 */
export async function askFriend(other: Profile, existing: Friendship[]): Promise<void> {
  const reverse = existing.find((f) => f.other.user_id === other.user_id && !f.sentByMe && f.status === 'pending')
  if (reverse) return acceptFriend(other.user_id)
  const { error } = await supabase.from('friendships').insert({ requester: await me(), addressee: other.user_id })
  if (error && error.code !== '23505') throw error
}

export async function acceptFriend(requesterId: string): Promise<void> {
  const { error } = await supabase.rpc('accept_friend', { p_requester: requesterId })
  if (error) throw error
}

/** Refuser, annuler une demande ou retirer un ami : la ligne disparaît, dans un sens comme dans l'autre. */
export async function removeFriend(otherId: string): Promise<void> {
  const uid = await me()
  const { error } = await supabase
    .from('friendships')
    .delete()
    .or(`and(requester.eq.${uid},addressee.eq.${otherId}),and(requester.eq.${otherId},addressee.eq.${uid})`)
  if (error) throw error
}

/* ---------------------------------------------------- bibliothèque d'un ami -- */

export type FriendLibrary = {
  shows: TrackedShow[]
  movies: WatchedMovie[]
  books: TrackedBook[]
}

/**
 * Ce que l'ami laisse voir : la base ne renvoie rien de caché, et rien du
 * tout si l'amitié n'est pas acceptée.
 */
export async function fetchFriendLibrary(userId: string): Promise<FriendLibrary> {
  const [shows, movies, books] = await Promise.all([
    supabase
      .from('tracked_shows')
      .select('show_id, name, image_url, added_at, last_watched_at, status, rewatches, rewatching, rating')
      .eq('user_id', userId),
    supabase
      .from('watched_movies')
      .select('movie_id, title, poster_url, release_year, release_date, watched_at, runtime, status, rating')
      .eq('user_id', userId),
    supabase.from('tracked_books').select('*').eq('user_id', userId),
  ])
  // Livres pas encore installés chez soi : on ignore plutôt que tout faire échouer.
  const books_ = books.error && isMissingSchema(books.error) ? [] : (books.data ?? [])
  if (shows.error) throw shows.error
  if (movies.error) throw movies.error
  if (books.error && !isMissingSchema(books.error)) throw books.error
  return {
    shows: (shows.data ?? []) as TrackedShow[],
    movies: (movies.data ?? []) as WatchedMovie[],
    books: books_ as TrackedBook[],
  }
}

/** Masque ou montre une série, un film ou un livre aux amis. */
export async function setHidden(
  table: 'tracked_shows' | 'watched_movies' | 'tracked_books',
  idColumn: 'show_id' | 'movie_id' | 'book_id',
  id: number | string,
  hidden: boolean,
): Promise<void> {
  const { error } = await supabase.from(table).update({ hidden }).eq(idColumn, id).eq('user_id', await me())
  if (error) throw error
}

/** Lien d'invitation : ouvre le profil, avec le bouton pour demander en ami. */
export const inviteLink = (username: string) =>
  `${window.location.origin}${window.location.pathname}#/ami/${encodeURIComponent(username)}`
