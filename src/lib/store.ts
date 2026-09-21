import { supabase } from './supabase'
import type { TvEpisode, TvShow } from './tvmaze'

export type TrackedShow = {
  show_id: number
  name: string
  image_url: string | null
  added_at: string
  last_watched_at: string | null
}

const PAGE = 1000

export async function fetchTracked(): Promise<TrackedShow[]> {
  const { data, error } = await supabase
    .from('tracked_shows')
    .select('show_id, name, image_url, added_at, last_watched_at')
  if (error) throw error
  return data ?? []
}

export async function fetchWatched(): Promise<Map<number, Set<number>>> {
  const map = new Map<number, Set<number>>()
  // Supabase renvoie 1000 lignes max par requête : on pagine.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('watched_episodes')
      .select('show_id, episode_id')
      .order('episode_id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    for (const row of data ?? []) {
      let set = map.get(row.show_id)
      if (!set) map.set(row.show_id, (set = new Set()))
      set.add(row.episode_id)
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
  return { show_id: show.id, name: show.name, image_url: row.image_url, added_at: new Date().toISOString(), last_watched_at: null }
}

export async function untrackShow(showId: number): Promise<void> {
  const a = await supabase.from('watched_episodes').delete().eq('show_id', showId)
  if (a.error) throw a.error
  const b = await supabase.from('tracked_shows').delete().eq('show_id', showId)
  if (b.error) throw b.error
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function markWatched(userId: string, showId: number, eps: TvEpisode[]): Promise<void> {
  if (!eps.length) return
  const rows = eps.map((e) => ({
    user_id: userId,
    episode_id: e.id,
    show_id: showId,
    season: e.season,
    number: e.number,
  }))
  for (const batch of chunks(rows, 500)) {
    const { error } = await supabase
      .from('watched_episodes')
      .upsert(batch, { onConflict: 'user_id,episode_id', ignoreDuplicates: true })
    if (error) throw error
  }
  const { error } = await supabase
    .from('tracked_shows')
    .update({ last_watched_at: new Date().toISOString() })
    .eq('show_id', showId)
  if (error) throw error
}

export async function markUnwatched(ids: number[]): Promise<void> {
  for (const batch of chunks(ids, 300)) {
    const { error } = await supabase.from('watched_episodes').delete().in('episode_id', batch)
    if (error) throw error
  }
}
