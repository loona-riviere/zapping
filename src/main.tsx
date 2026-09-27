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

// iPhone, app ajoutée à l'écran d'accueil : à l'ouverture du clavier, iOS
// fait défiler la page pour montrer le champ ; à la fermeture, il oublie de
// revenir et la page reste défilée au-delà de sa fin — un grand vide sous la
// barre du bas. On ramène le défilement dans les limites de la page, à
// plusieurs reprises le temps que l'animation du clavier se termine (un
// recalage trop tôt est défait par iOS juste après).
function clampScroll() {
  const active = document.activeElement
  if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return // clavier encore là
  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
  if (window.scrollY > max) window.scrollTo(0, max)
  else if (window.visualViewport && window.visualViewport.offsetTop > 0) window.scrollTo(0, window.scrollY)
}
function realignAfterKeyboard() {
  for (const delay of [50, 250, 500, 900]) setTimeout(clampScroll, delay)
}
document.addEventListener('focusout', realignAfterKeyboard)
window.visualViewport?.addEventListener('resize', realignAfterKeyboard)
window.visualViewport?.addEventListener('scroll', () => setTimeout(clampScroll, 50))
