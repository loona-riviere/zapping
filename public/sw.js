// Service worker : notifications push, et de quoi ouvrir l'appli sans réseau.
//   — pages : réseau d'abord (toujours la dernière version), copie sinon ;
//   — fichiers /assets/ (nommés par leur contenu, donc immuables) : copie
//     d'abord, réseau sinon ;
//   — icônes, manifeste : copie tout de suite, mise à jour en arrière-plan.
// Les appels aux API (Supabase, TMDB, fonctions Netlify…) ne passent pas ici.
const CACHE = 'zapping-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/.netlify/')) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/index.html', copy))
          return res
        })
        .catch(() => caches.match('/index.html').then((r) => r || Response.error())),
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
    return
  }

  if (/\.(png|svg|webmanifest|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy))
            }
            return res
          })
          .catch(() => hit)
        return hit || fresh
      }),
    )
  }
})

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
