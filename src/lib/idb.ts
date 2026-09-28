// Petit magasin clé → valeur dans IndexedDB, pour les caches volumineux (fiches
// TVmaze avec tous les épisodes). Le localStorage de Safari plafonne vers 5 Mo
// et se partage avec la session : une centaine de séries suffisait à le
// remplir. IndexedDB a une marge bien plus large et ne gêne pas la session.
// Si IndexedDB est indisponible (navigation privée stricte…), tout devient
// sans effet et l'app retombe sur le réseau.

const DB = 'zapping'
const STORE = 'cache'

let opening: Promise<IDBDatabase | null> | null = null

function db(): Promise<IDBDatabase | null> {
  if (!opening) {
    opening = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB, 1)
        req.onupgradeneeded = () => req.result.createObjectStore(STORE)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
        req.onblocked = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  }
  return opening
}

export async function idbGetMany<T>(keys: string[]): Promise<Map<string, T>> {
  const out = new Map<string, T>()
  const d = await db()
  if (!d || !keys.length) return out
  return new Promise((resolve) => {
    try {
      const store = d.transaction(STORE, 'readonly').objectStore(STORE)
      let left = keys.length
      for (const key of keys) {
        const req = store.get(key)
        req.onsuccess = () => {
          if (req.result !== undefined) out.set(key, req.result as T)
          if (--left === 0) resolve(out)
        }
        req.onerror = () => {
          if (--left === 0) resolve(out)
        }
      }
    } catch {
      resolve(out)
    }
  })
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  return (await idbGetMany<T>([key])).get(key)
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const d = await db()
  if (!d) return
  try {
    d.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key)
  } catch {
    /* quota ou base fermée : ce cache sera simplement refait plus tard */
  }
}
