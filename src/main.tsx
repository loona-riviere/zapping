import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './lib/install'
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
// revenir et la page reste défilée au-delà de sa fin. On recale le
// défilement, mais seulement juste après la fermeture du clavier : le faire
// pendant un défilement normal (événements « scroll » du viewport) donnait
// des à-coups et une barre du bas au milieu de l'écran.
const isTyping = (el: Element | null) =>
  !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
    (el.tagName === 'INPUT' && !/^(checkbox|radio|range|button|submit)$/.test((el as HTMLInputElement).type)))

function clampScroll() {
  if (isTyping(document.activeElement)) return // clavier encore là
  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
  if (window.scrollY > max) window.scrollTo(0, max)
}
// Pendant la frappe, la barre du bas se cache (comme dans les apps natives) :
// elle ne remonte plus avec le clavier. On se fie à la place réellement prise
// par le clavier, pas au seul focus : un champ sélectionné d'office (la
// recherche) sans clavier ouvert ne doit pas faire disparaître la barre.
function syncTyping() {
  const vv = window.visualViewport
  const keyboard = !!vv && window.innerHeight - vv.height > 150
  document.documentElement.classList.toggle('is-typing', keyboard && isTyping(document.activeElement))
}
document.addEventListener('focusin', () => setTimeout(syncTyping, 300))
document.addEventListener('focusout', () => {
  setTimeout(syncTyping, 0)
  for (const delay of [100, 400, 800]) setTimeout(clampScroll, delay)
})
window.visualViewport?.addEventListener('resize', syncTyping)

// Pincer pour zoomer : Safari ignore « user-scalable=no » dans un onglet, mais
// on peut bloquer le geste. Seulement dans l'appli installée, pour laisser le
// zoom à qui en a besoin dans le navigateur.
if (window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone) {
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false })
  }
}
