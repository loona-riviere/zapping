import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { registerServiceWorker } from './lib/push'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker()

// Clic sur une notif avec l'app déjà ouverte dans un onglet : le service
// worker demande la navigation plutôt que de rouvrir un onglet en double.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'navigate' && typeof event.data.url === 'string') {
      const hash = event.data.url.split('#')[1]
      if (hash) window.location.hash = hash
    }
  })
}

// iPhone, app ajoutée à l'écran d'accueil : quand le clavier se ferme, iOS
// laisse parfois les éléments fixés (barre du bas) remontés de la hauteur
// du clavier, avec un grand vide dessous, jusqu'au prochain défilement. Un
// petit défilement forcé, une fois le clavier parti, recale tout.
function realignAfterKeyboard() {
  setTimeout(() => {
    const active = document.activeElement
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return // clavier encore là
    // Page trop courte pour défiler (le décalage vient alors d'iOS seul) :
    // retour tout en haut. Sinon un pixel aller-retour, sans bouger la vue.
    if (document.documentElement.scrollHeight <= window.innerHeight) {
      window.scrollTo(0, 0)
    } else {
      window.scrollBy(0, 1)
      window.scrollBy(0, -1)
    }
  }, 120)
}
document.addEventListener('focusout', realignAfterKeyboard)
window.visualViewport?.addEventListener('resize', () => {
  // Le viewport visible retrouve (presque) toute la fenêtre : le clavier vient de partir.
  if (window.visualViewport && window.visualViewport.height >= window.innerHeight - 1) realignAfterKeyboard()
})
