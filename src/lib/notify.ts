import { supabase } from './supabase'

type Event =
  | { event: 'friend_request' | 'friend_accept'; to: string }
  | { event: 'rec'; to: string; kind: string; itemId: string }
  | { event: 'duo'; to: string; showId: number }
  | { event: 'movie_together'; to: string; movieId: number }
  | { event: 'show_together'; to: string; showId: number }
  | { event: 'test'; to: string }
  | { event: 'comment'; to: string; commentId: number }

/**
 * Prévient l'autre sur son téléphone (s'il a activé les notifications).
 * Sans attendre ni rien signaler : une notif perdue ne doit jamais faire
 * échouer l'action elle-même.
 */
export function notify(e: Event): void {
  void (async () => {
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) return
      await fetch('/.netlify/functions/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(e),
      })
    } catch {
      /* hors ligne, fonction absente en local… tant pis pour la notif */
    }
  })()
}

/** Envoie une notif de test sur ses propres appareils ; renvoie le diagnostic. */
export async function testNotification(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const uid = data.session?.user.id
  if (!token || !uid) return 'Pas connecté'
  try {
    const res = await fetch('/.netlify/functions/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ event: 'test', to: uid }),
    })
    const text = await res.text()
    let json: { sent?: number; reason?: string; errorMessage?: string } | null = null
    try {
      json = JSON.parse(text)
    } catch {
      /* pas du JSON : on montre le début de la réponse */
    }
    if (json?.sent) return `Envoyée à ${json.sent} appareil${json.sent > 1 ? 's' : ''}. Elle arrive dans quelques secondes.`
    return `Non envoyée (${res.status}) : ${json?.reason ?? json?.errorMessage ?? (text.slice(0, 160) || 'réponse vide')}`
  } catch (e) {
    return `Échec : ${(e as Error).message}`
  }
}

/** Types de notifications qu'on peut couper (mêmes clés côté Netlify, netlify/lib/push.ts). */
export const NOTIF_CATEGORIES = [
  { id: 'episodes', label: 'Nouvel épisode d’une série suivie' },
  { id: 'movies', label: 'Film de ma liste au cinéma ou sur une plateforme' },
  { id: 'recs', label: 'Recommandation d’un ami' },
  { id: 'comments', label: 'Commentaire d’un ami sur un titre que j’ai' },
  { id: 'mentions', label: 'Quand un ami me mentionne' },
  { id: 'together', label: 'Vu ensemble, série cochée à deux' },
  { id: 'friends', label: 'Demande d’ami acceptée ou reçue' },
] as const

export type NotifCategory = (typeof NOTIF_CATEGORIES)[number]['id']

/** Les types coupés (tout est activé par défaut). */
export async function mutedCategories(): Promise<NotifCategory[]> {
  const { data } = await supabase.from('notif_prefs').select('off').maybeSingle()
  return (data?.off ?? []) as NotifCategory[]
}

export async function setMutedCategories(off: NotifCategory[]): Promise<void> {
  const { data: auth } = await supabase.auth.getSession()
  const uid = auth.session?.user.id
  if (!uid) throw new Error('Pas connecté')
  const { error } = await supabase
    .from('notif_prefs')
    .upsert({ user_id: uid, off, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) throw error
}
