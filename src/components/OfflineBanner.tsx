import { useEffect, useState } from 'react'
import { pendingCount } from '../lib/offlineQueue'

/**
 * Hors connexion : on voit sa dernière copie, et ce qu'on coche attend le
 * retour du réseau (file d'attente). Au retour, un petit « ✓ synchronisé ».
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const [pending, setPending] = useState(() => pendingCount())
  const [synced, setSynced] = useState<number | null>(null)

  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    const queue = (e: Event) => setPending((e as CustomEvent<number>).detail)
    let t: number | undefined
    const done = (e: Event) => {
      setSynced((e as CustomEvent<number>).detail)
      clearTimeout(t)
      t = window.setTimeout(() => setSynced(null), 3500)
    }
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    window.addEventListener('zapping:queue', queue)
    window.addEventListener('zapping:synced', done)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      window.removeEventListener('zapping:queue', queue)
      window.removeEventListener('zapping:synced', done)
      clearTimeout(t)
    }
  }, [])

  if (offline || pending > 0) {
    return (
      <p className="offline-banner" role="status">
        📡 {offline ? 'Hors connexion' : 'Connexion instable'}
        {pending > 0
          ? ` — ${pending} modification${pending > 1 ? 's' : ''} en attente, envoyée${pending > 1 ? 's' : ''} au retour du réseau.`
          : ' — tes modifications seront envoyées au retour du réseau.'}
      </p>
    )
  }
  if (synced) {
    return (
      <p className="offline-banner offline-banner--ok" role="status">
        ✓ {synced} modification{synced > 1 ? 's' : ''} synchronisée{synced > 1 ? 's' : ''}
      </p>
    )
  }
  return null
}
