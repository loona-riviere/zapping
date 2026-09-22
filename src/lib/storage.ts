// Le localStorage de Safari plafonne vers 5 Mo par site. Les caches de l'app
// (fiches TVmaze avec tous les épisodes, suggestions TMDB…) finissaient par
// le remplir ; l'écriture de la session Supabase échouait alors sans bruit,
// et chaque réouverture de l'app déconnectait. La session passe donc
// toujours avant les caches : ceux-ci sont vidés, les plus anciens d'abord,
// pour lui faire de la place.

// Préfixes de clés de cache, régénérables à volonté. Tout le reste (session,
// réglages) n'est jamais touché.
const CACHE_PREFIXES = ['tvmaze:', 'tmdb:', 'zapping:top10', 'zapping:ai:']
// Taille en caractères (clés + valeurs) au-delà de laquelle on fait du ménage
// à l'ouverture, bien avant le plafond de Safari.
const SOFT_LIMIT = 2_000_000

const isCache = (key: string) => CACHE_PREFIXES.some((p) => key.startsWith(p))

function entries(): { key: string; size: number; at: number }[] {
  const out: { key: string; size: number; at: number }[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      const value = localStorage.getItem(key) ?? ''
      let at = 0
      if (isCache(key) && value.startsWith('{"at":')) at = Number(value.slice(6, value.indexOf(',', 6))) || 0
      out.push({ key, size: key.length + value.length, at })
    }
  } catch {
    /* stockage inaccessible (navigation privée…) : rien à mesurer */
  }
  return out
}

/** Supprime des caches, les plus anciens d'abord, jusqu'à passer sous `target` caractères. */
export function pruneCaches(target: number) {
  const all = entries()
  let total = all.reduce((n, e) => n + e.size, 0)
  const caches = all.filter((e) => isCache(e.key)).sort((a, b) => a.at - b.at)
  for (const e of caches) {
    if (total <= target) break
    try {
      localStorage.removeItem(e.key)
    } catch {
      /* rien à faire */
    }
    total -= e.size
  }
}

/** À l'ouverture : garde de la marge pour que la session puisse toujours s'écrire. */
export function ensureStorageHeadroom() {
  const total = entries().reduce((n, e) => n + e.size, 0)
  if (total > SOFT_LIMIT) pruneCaches(SOFT_LIMIT * 0.6)
}

/**
 * Stockage de la session Supabase : si l'écriture échoue faute de place, on
 * vide les caches et on réessaie, au lieu de perdre la session.
 */
export const authStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch {
      pruneCaches(0)
      try {
        localStorage.setItem(key, value)
      } catch {
        /* vraiment impossible (navigation privée stricte) : session en mémoire seulement */
      }
    }
  },
  removeItem(key: string) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* rien à faire */
    }
  },
}

/** Écriture de cache : si la place manque, on fait du ménage dans les caches puis on réessaie une fois. */
export function setCacheItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    pruneCaches(SOFT_LIMIT * 0.6)
    try {
      localStorage.setItem(key, value)
    } catch {
      /* toujours pas de place : tant pis pour ce cache */
    }
  }
}
