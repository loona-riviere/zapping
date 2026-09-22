import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

export const pushConfigured = Boolean(VAPID_PUBLIC_KEY)

/**
 * iOS n'autorise le Push API que pour une appli lancée depuis l'écran
 * d'accueil (mode standalone) — jamais depuis un onglet Safari classique.
 * `navigator.standalone` est la propriété historique de Safari iOS ;
 * `display-mode: standalone` couvre les autres navigateurs.
 */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64Safe)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return Promise.resolve(null)
  return navigator.serviceWorker.register('/sw.js').catch(() => null)
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.ready.catch(() => null)
  if (!reg) return null
  return reg.pushManager.getSubscription()
}

/** Demande la permission puis abonne l'appareil — à appeler depuis un clic. */
export async function enableNotifications(): Promise<'ok' | 'denied' | 'unsupported'> {
  if (!pushSupported() || !VAPID_PUBLIC_KEY) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'

  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    }))

  const json = sub.toJSON()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user || !json.endpoint || !json.keys) return 'unsupported'

  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: auth.user.id,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth_key: json.keys.auth,
  })
  if (error) return 'unsupported'
  return 'ok'
}

export async function disableNotifications(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe().catch(() => {})
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
}
