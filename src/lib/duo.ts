// Séries à deux : une série regardée ensemble (en couple, entre amis).
// L'écriture chez l'autre passe par des fonctions Supabase qui vérifient
// que la série a bien été acceptée à deux (supabase/schema.sql).

import type { Profile } from './social'
import { isMissingSchema } from './store'
import { me, supabase } from './supabase'
import type { TvEpisode } from './tvmaze'

export type Duo = {
  show_id: number
  show_name: string
  image_url: string | null
  partnerId: string
  status: 'pending' | 'accepted'
  /** Vrai si c'est moi qui ai proposé. */
  sentByMe: boolean
}

type Row = {
  show_id: number
  inviter: string
  invitee: string
  status: 'pending' | 'accepted'
  show_name: string
  image_url: string | null
}

/** Séries acceptées à deux, pour savoir sans attendre s'il faut reporter une coche chez l'autre. */
const acceptedShows = new Set<number>()

/** null : tables des séries à deux absentes (schéma pas relancé). */
export async function fetchDuos(): Promise<Duo[] | null> {
  const uid = await me()
  const { data, error } = await supabase.from('shared_shows').select('show_id, inviter, invitee, status, show_name, image_url')
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  const duos = ((data ?? []) as Row[]).map((r) => ({
    show_id: r.show_id,
    show_name: r.show_name,
    image_url: r.image_url,
    partnerId: r.inviter === uid ? r.invitee : r.inviter,
    status: r.status,
    sentByMe: r.inviter === uid,
  }))
  acceptedShows.clear()
  duos.filter((d) => d.status === 'accepted').forEach((d) => acceptedShows.add(d.show_id))
  return duos
}

export async function inviteDuo(show: { id: number; name: string; image: string | null }, partner: Profile): Promise<void> {
  const { error } = await supabase.from('shared_shows').insert({
    show_id: show.id,
    inviter: await me(),
    invitee: partner.user_id,
    show_name: show.name,
    image_url: show.image,
  })
  if (error && error.code !== '23505') throw error
}

export async function acceptDuo(showId: number, inviterId: string): Promise<void> {
  const { error } = await supabase.rpc('accept_shared_show', { p_show_id: showId, p_inviter: inviterId })
  if (error) throw error
}

/** Refuser, annuler ou arrêter : chacun garde ses épisodes cochés, seul le lien disparaît. */
export async function stopDuo(showId: number, partnerId: string): Promise<void> {
  const uid = await me()
  const { error } = await supabase
    .from('shared_shows')
    .delete()
    .eq('show_id', showId)
    .or(`and(inviter.eq.${uid},invitee.eq.${partnerId}),and(inviter.eq.${partnerId},invitee.eq.${uid})`)
  if (error) throw error
  acceptedShows.delete(showId)
}

/**
 * Après avoir coché ou décoché des épisodes chez soi : les reporte chez le
 * partenaire si la série est regardée à deux. Silencieux en cas d'échec —
 * ce n'est pas une raison d'annuler sa propre coche.
 */
export async function syncDuo(
  showId: number,
  eps: TvEpisode[],
  watched: boolean,
  dates?: Map<number, string | null>,
): Promise<void> {
  if (!acceptedShows.has(showId) || !eps.length) return
  const now = new Date().toISOString()
  const payload = eps.map((e) => ({
    episode_id: e.id,
    season: e.season,
    number: e.number,
    watched_at: dates ? (dates.get(e.id) ?? null) : now,
  }))
  const { error } = await supabase.rpc('sync_shared_episodes', { p_show_id: showId, p_episodes: payload, p_watched: watched })
  if (error) console.warn('Série à deux : report impossible', error.message)
}
