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
