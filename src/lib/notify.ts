import { supabase } from './supabase'

type Event =
  | { event: 'friend_request' | 'friend_accept'; to: string }
  | { event: 'rec'; to: string; kind: string; itemId: string }
  | { event: 'duo'; to: string; showId: number }
  | { event: 'movie_together'; to: string; movieId: number }

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
