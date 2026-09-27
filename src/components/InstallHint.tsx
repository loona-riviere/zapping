import { useEffect, useState } from 'react'
import { canPromptInstall, isIos, onInstallChange, promptInstall } from '../lib/install'
import { isStandalone } from '../lib/push'
import { Sheet } from './Sheet'

const KEY = 'zapping.installHint'

/** L'icône « Partager » de Safari, pour la reconnaître sans chercher. */
const ShareIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12" />
    <path d="m7 8 5-5 5 5" />
    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>
)

/**
 * Bandeau « Installe Zapping », hors de l'appli installée :
 *   — Chrome / Android : un vrai bouton « Installer » ;
 *   — iPhone : « Comment faire ? » ouvre les étapes (Safari ne laisse
 *     aucun site s'installer tout seul), y compris depuis WhatsApp.
 * Refermable, pour de bon.
 */
export function InstallHint() {
  const [, force] = useState(0)
  const [steps, setSteps] = useState(false)
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(KEY) === 'no'
    } catch {
      return false
    }
  })
  useEffect(() => onInstallChange(() => force((n) => n + 1)), [])

  const ios = isIos()
  const prompt = canPromptInstall()
  if (hidden || isStandalone() || (!ios && !prompt)) return null

  const hide = () => {
    setHidden(true)
    try {
      localStorage.setItem(KEY, 'no')
    } catch {
      /* tant pis */
    }
  }

  return (
    <>
      <aside className="install-hint">
        <img src="/icon-192.png" alt="" className="install-hint__icon" />
        <p>
          <strong>Installe Zapping</strong>
          <span>Sur ton écran d'accueil, comme une vraie appli.</span>
        </p>
        <button
          type="button"
          className="btn btn--primary install-hint__btn"
          onClick={() => (prompt ? promptInstall() : setSteps(true))}
        >
          {prompt ? 'Installer' : 'Comment ?'}
        </button>
        <button type="button" className="install-hint__close" aria-label="Masquer" onClick={hide}>
          ✕
        </button>
      </aside>
      {steps && (
        <Sheet title="Installer sur iPhone" onClose={() => setSteps(false)}>
          <ol className="install-steps">
            <li>
              <span className="install-steps__n">1</span>
              <span>
                Ouvre ce site dans <b>Safari</b>. Ouvert depuis WhatsApp, Instagram ou Messenger ? Touche le bouton de
                partage puis <b>« Ouvrir dans Safari »</b>.
              </span>
            </li>
            <li>
              <span className="install-steps__n">2</span>
              <span>
                Dans Safari, touche <b>Partager</b> <span className="install-steps__icon"><ShareIcon /></span> en bas de
                l'écran (ou en haut sur iPad).
              </span>
            </li>
            <li>
              <span className="install-steps__n">3</span>
              <span>
                Fais défiler et choisis <b>« Sur l'écran d'accueil »</b>, puis <b>Ajouter</b>.
              </span>
            </li>
          </ol>
          <p className="muted install-steps__foot">Zapping s'ouvre ensuite en plein écran depuis son icône, notifications comprises.</p>
          <button className="btn btn--primary sheet__cta" onClick={() => setSteps(false)}>
            J'ai compris
          </button>
        </Sheet>
      )}
    </>
  )
}
