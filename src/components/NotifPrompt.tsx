import { useEffect, useState } from 'react'
import { usePrefs } from '../lib/prefs'
import { currentSubscription, enableNotifications, isStandalone, pushConfigured, pushSupported } from '../lib/push'
import { Sheet } from './Sheet'

const KEY = 'zapping.notifPrompt'

function answered(): boolean {
  try {
    return localStorage.getItem(KEY) !== null
  } catch {
    return true // stockage indisponible : on ne harcèle pas
  }
}
function remember(v: 'yes' | 'no') {
  try {
    localStorage.setItem(KEY, v)
  } catch {
    /* tant pis : la question reviendra une fois */
  }
}

/**
 * Proposer les notifications une fois, sur l'appli installée, avant la
 * fenêtre du système (qu'on ne peut montrer qu'une fois : mieux vaut
 * expliquer d'abord pourquoi). « Pas maintenant » est définitif ; on peut
 * toujours les activer plus tard dans les paramètres.
 *
 * Permission déjà accordée sur cet appareil mais pas d'abonnement (appli
 * réinstallée…) : on réabonne sans rien demander.
 */
export function NotifPrompt() {
  const { has } = usePrefs()
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!pushConfigured || !pushSupported() || !isStandalone()) return
    let alive = true
    const t = setTimeout(async () => {
      const sub = await currentSubscription().catch(() => null)
      if (!alive || sub) return
      if (Notification.permission === 'granted') {
        void enableNotifications()
        return
      }
      if (Notification.permission === 'default' && !answered()) setShow(true)
    }, 2500)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [])

  if (!show) return null
  const close = (v: 'yes' | 'no') => {
    remember(v)
    setShow(false)
  }

  return (
    <Sheet title="Ne rate rien" onClose={() => close('no')}>
      <div className="notif-prompt">
        <span className="notif-prompt__bell" aria-hidden="true">🔔</span>
        <ul>
          {has('show') && <li>📺 Un nouvel épisode d'une série que tu suis</li>}
          <li>📨 Un ami te recommande une série, un film ou un livre</li>
          <li>👫 Une demande d'ami, ou un ami qui accepte la tienne</li>
        </ul>
        <p className="muted">Rien d'autre, promis. Tu pourras changer d'avis dans les paramètres.</p>
      </div>
      <button
        className="btn btn--primary sheet__cta"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await enableNotifications().catch(() => null)
          close('yes')
        }}
      >
        {busy ? 'Un instant…' : 'Activer les notifications'}
      </button>
      <button className="btn btn--ghost sheet__cta" onClick={() => close('no')}>
        Pas maintenant
      </button>
    </Sheet>
  )
}
