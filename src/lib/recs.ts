// Recommandations entre amis : une série, un film ou un livre, avec un
// petit mot facultatif. Le destinataire l'ajoute à sa liste ou la refuse ;
// dans les deux cas elle disparaît.

import type { Book } from './books'
import { isMissingSchema } from './store'
import { me, supabase } from './supabase'
import type { Movie } from './tmdb'

export type RecKind = 'show' | 'movie' | 'book'

/** De quoi ajouter le titre à sa liste sans rien aller rechercher. */
export type RecMeta =
  | { kind: 'show'; id: number; name: string; image: string | null }
  | { kind: 'movie'; movie: Movie }
  | { kind: 'book'; book: Book }

export type Rec = {
  id: number
  sender: string
  recipient: string
  kind: RecKind
  item_id: string
  title: string
  image_url: string | null
  meta: RecMeta
  note: string | null
  created_at: string
}

/** null : table absente (schéma pas relancé). */
export async function fetchRecs(): Promise<Rec[] | null> {
  const { data, error } = await supabase
    .from('recommendations')
    .select('id, sender, recipient, kind, item_id, title, image_url, meta, note, created_at')
    .order('created_at', { ascending: false })
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  return (data ?? []) as Rec[]
}

export async function sendRecs(
  recipients: string[],
  item: { kind: RecKind; itemId: string; title: string; image: string | null; meta: RecMeta },
  note: string,
): Promise<void> {
  const sender = await me()
  const rows = recipients.map((recipient) => ({
    sender,
    recipient,
    kind: item.kind,
    item_id: item.itemId,
    title: item.title,
    image_url: item.image,
    meta: item.meta,
    note: note.trim() || null,
  }))
  const { error } = await supabase
    .from('recommendations')
    .upsert(rows, { onConflict: 'sender,recipient,kind,item_id', ignoreDuplicates: true })
  if (error) throw error
}

export async function removeRec(id: number): Promise<void> {
  const { error } = await supabase.from('recommendations').delete().eq('id', id)
  if (error) throw error
}

const LIBRARY: Record<RecKind, { table: string; column: string }> = {
  show: { table: 'tracked_shows', column: 'show_id' },
  movie: { table: 'watched_movies', column: 'movie_id' },
  book: { table: 'tracked_books', column: 'book_id' },
}

/**
 * Parmi ces amis, ceux qui ont déjà le titre dans leur liste (vu, en cours
 * ou prévu) : inutile de le leur recommander. Ce qu'un ami a caché ne
 * remonte pas — il peut donc recevoir la recommandation d'un titre caché.
 */
export async function friendsWhoHave(kind: RecKind, itemId: string, friendIds: string[]): Promise<Set<string>> {
  if (!friendIds.length) return new Set()
  const { table, column } = LIBRARY[kind]
  const { data, error } = await supabase
    .from(table)
    .select('user_id')
    .eq(column, kind === 'book' ? itemId : Number(itemId))
    .in('user_id', friendIds)
  if (error) return new Set()
  return new Set((data ?? []).map((r: { user_id: string }) => r.user_id))
}
