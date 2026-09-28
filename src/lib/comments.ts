// Commentaires entre amis sur un épisode, un film ou un livre. La lecture
// est filtrée par la base (RLS) : ses propres commentaires et ceux de ses amis.

import { isMissingSchema } from './store'
import { supabase } from './supabase'

export type CommentKind = 'episode' | 'movie' | 'book'

export type Comment = {
  id: number
  user_id: string
  kind: CommentKind
  item_id: string
  show_id: number | null
  title: string
  body: string
  spoiler: boolean
  created_at: string
  edited_at?: string | null
}

/** null : table absente (schéma pas relancé). */
export async function fetchComments(kind: CommentKind, itemId: string): Promise<Comment[] | null> {
  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .eq('kind', kind)
    .eq('item_id', itemId)
    .order('created_at', { ascending: true })
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  return (data ?? []) as Comment[]
}

export async function addComment(c: {
  kind: CommentKind
  itemId: string
  showId?: number
  title: string
  body: string
  spoiler: boolean
}): Promise<Comment> {
  const { data, error } = await supabase
    .from('comments')
    .insert({ kind: c.kind, item_id: c.itemId, show_id: c.showId ?? null, title: c.title, body: c.body.trim(), spoiler: c.spoiler })
    .select('*')
    .single()
  if (error) throw error
  return data as Comment
}

export async function editComment(id: number, body: string): Promise<string> {
  const edited_at = new Date().toISOString()
  const { error } = await supabase.from('comments').update({ body: body.trim(), edited_at }).eq('id', id)
  if (error) throw error
  return edited_at
}

export async function deleteComment(id: number): Promise<void> {
  const { error } = await supabase.from('comments').delete().eq('id', id)
  if (error) throw error
}

/** « à l'instant », « il y a 5 min », « hier », « 3 août »… */
export function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return "à l'instant"
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`
  if (s < 172800) return 'hier'
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

/**
 * Nombre de commentaires par épisode d'une série (les miens et ceux de mes
 * amis, filtrés par la base), pour les signaler sur la grille des épisodes.
 */
export async function episodeCommentCounts(showId: number): Promise<Map<number, number>> {
  const { data, error } = await supabase.from('comments').select('item_id').eq('kind', 'episode').eq('show_id', showId)
  if (error) {
    if (isMissingSchema(error)) return new Map()
    throw error
  }
  const counts = new Map<number, number>()
  for (const c of data ?? []) counts.set(Number(c.item_id), (counts.get(Number(c.item_id)) ?? 0) + 1)
  return counts
}
