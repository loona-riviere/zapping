// Service worker minimal : juste de quoi recevoir et afficher les
// notifications push, même appli fermée. Pas de mise en cache hors-ligne
// ici (pas demandé, pas fait), un service worker sert de point d'entrée
// obligatoire pour le Push API que l'app soit ouverte ou non.

self.addEventListener('push', (event) => {
  let payload = { title: 'Zapping', body: '' }
  try {
    if (event.data) payload = event.data.json()
  } catch {
    /* payload illisible : notif générique */
  }
  const url = payload.url || '/'
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url },
    }),
  )
})

// Ouvre (ou ramène au premier plan) un onglet déjà ouvert sur l'app plutôt
// que d'en empiler un nouveau à chaque notif cliquée.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.postMessage({ type: 'navigate', url })
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
