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
