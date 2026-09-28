import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import webpush from 'web-push'

// Ce qui est commun aux fonctions qui envoient des notifs push (notify,
// flush-notifs, check-new-episodes, movie-releases) : variables
// d'environnement, client Supabase côté serveur, envoi à une liste
// d'appareils avec nettoyage des abonnements morts.

// Côté serveur, pas de temps réel : sur un Node sans WebSocket natif (< 22),
// supabase-js refuse sinon de se créer (« native WebSocket not found »). Le
// transport fourni n'est jamais utilisé, on ne s'abonne à rien.
const SERVER_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: class {} as unknown as typeof WebSocket },
}

export type SubRow = { user_id?: string; endpoint: string; p256dh: string; auth_key: string }
export type PushPayload = { title: string; body: string; url: string }

/**
 * Prépare l'envoi : vérifie les variables Netlify, configure VAPID et crée
 * le client Supabase. Clé service_role : bypasse la RLS exprès, seule façon
 * pour une tâche de fond de lire/écrire pour tous les utilisateurs.
 * Renvoie la liste des variables manquantes si l'une d'elles fait défaut.
 */
export function setupPush(): { db: SupabaseClient; missing?: undefined } | { db?: undefined; missing: string[] } {
  const env = {
    SUPABASE_URL: Netlify.env.get('SUPABASE_URL') || Netlify.env.get('VITE_SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    VAPID_PUBLIC_KEY: Netlify.env.get('VAPID_PUBLIC_KEY'),
    VAPID_PRIVATE_KEY: Netlify.env.get('VAPID_PRIVATE_KEY'),
    VAPID_SUBJECT: Netlify.env.get('VAPID_SUBJECT'),
  }
  const missing = Object.entries(env).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) return { missing }
  webpush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!)
  return { db: createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, SERVER_OPTIONS) }
}

/** Abonnements push, regroupés par utilisateur. */
export async function subscriptionsByUser(db: SupabaseClient, userIds?: string[]): Promise<Map<string, SubRow[]>> {
  let q = db.from('push_subscriptions').select('user_id, endpoint, p256dh, auth_key')
  if (userIds) q = q.in('user_id', userIds)
  const { data } = await q
  const byUser = new Map<string, SubRow[]>()
  for (const s of (data ?? []) as SubRow[]) byUser.set(s.user_id!, [...(byUser.get(s.user_id!) ?? []), s])
  return byUser
}

/**
 * Envoie `payload` à chaque appareil. Un abonnement mort (appli désinstallée,
 * permission révoquée : 404 ou 410) est supprimé au passage.
 * Renvoie le nombre d'envois réussis et le détail des refus.
 */
export async function sendPush(db: SupabaseClient, subs: SubRow[], payload: PushPayload) {
  let sent = 0
  const errors: string[] = []
  const body = JSON.stringify(payload)
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, body)
      sent++
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      const detail = (e as { body?: string }).body ?? (e as Error).message
      errors.push(`${status ?? '?'} ${detail}`.slice(0, 200))
      if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    }
  }
  return { sent, errors }
}

/** Types de notifications que chacun peut couper dans Paramètres (table notif_prefs). */
export type NotifCategory = 'episodes' | 'movies' | 'friends' | 'recs' | 'together' | 'comments' | 'mentions'

/** Ceux, parmi `userIds`, qui ont coupé ce type de notification. */
export async function mutedFor(db: SupabaseClient, userIds: string[], cat: NotifCategory): Promise<Set<string>> {
  if (!userIds.length) return new Set()
  const { data } = await db.from('notif_prefs').select('user_id').in('user_id', userIds).contains('off', [cat])
  return new Set((data ?? []).map((r) => r.user_id as string))
}
