import { useEffect, useState } from 'react'
import { testNotification } from '../lib/notify'
import {
  currentSubscription, disableNotifications, enableNotifications, pushConfigured, pushSupported,
} from '../lib/push'

type State = 'checking' | 'off' | 'on' | 'unsupported' | 'denied'

/**
 * Sur iPhone, le Push API n'existe (`'PushManager' in window`) que pour une
 * appli lancée depuis l'écran d'accueil — jamais dans un onglet Safari
 * classique. `pushSupported()` reflète déjà ça tout seul : pas la peine
 * d'un message séparé « installe l'icône », le message « indisponible ici »
 * suffit et reste vrai sur tous les navigateurs, pas seulement iOS.
 */
export function Notifications() {
  const [state, setState] = useState<State>('checking')
  const [test, setTest] = useState<string | null>(null)

  useEffect(() => {
    if (!pushConfigured || !pushSupported()) {
      setState('unsupported')
      return
    }
    currentSubscription().then((sub) => setState(sub ? 'on' : 'off'))
  }, [])

  async function toggle() {
    if (state === 'on') {
      setState('checking')
      await disableNotifications()
      setState('off')
      return
    }
    setState('checking')
    const result = await enableNotifications()
    setState(result === 'ok' ? 'on' : result === 'denied' ? 'denied' : 'unsupported')
  }

  return (
    <section>
      <h2 className="section-title">Notifications</h2>
      {state === 'unsupported' && (
        <p className="muted">
          Indisponible sur ce navigateur. Sur iPhone, ça marche uniquement depuis l'icône ajoutée à
          l'écran d'accueil (pas depuis Safari).
        </p>
      )}
      {state === 'denied' && (
        <p className="muted">
          Notifications refusées — à réactiver dans les réglages de l'appareil pour Zapping.
        </p>
      )}
      {(state === 'on' || state === 'off' || state === 'checking') && (
        <>
          <p className="muted">Une notif quand un nouvel épisode d'une série suivie sort, quand un film de ta liste « à voir » sort au cinéma ou arrive sur une plateforme, et quand un ami te recommande quelque chose ou te demande en ami.</p>
          <div className="settings__actions">
          <button
            type="button"
            className={`btn ${state === 'on' ? 'btn--ghost' : 'btn--primary'}`}
            onClick={toggle}
            disabled={state === 'checking'}
          >
            {state === 'on' ? 'Désactiver' : 'Activer les notifications'}
          </button>
          {state === 'on' && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={async () => {
                setTest('Envoi…')
                setTest(await testNotification())
              }}
            >
              🔔 Tester
            </button>
          )}
          </div>
          {test && <p className="muted" style={{ fontSize: '.85rem' }}>{test}</p>}
        </>
      )}
    </section>
  )
}
