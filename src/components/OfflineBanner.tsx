import { useEffect, useState } from 'react'

/** « Hors connexion » tant que le réseau manque : on voit sa dernière copie. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  if (!offline) return null
  return (
    <p className="offline-banner" role="status">
      📡 Hors connexion — tu vois ta dernière copie. Ce que tu coches ne sera pas enregistré.
    </p>
  )
}
