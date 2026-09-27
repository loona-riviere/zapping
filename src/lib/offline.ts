// Hors connexion : chaque liste chargée avec succès est gardée sur l'appareil ;
// sans réseau, on ressert la dernière copie plutôt qu'un écran vide. Par
// compte (identifiant dans la clé), pour ne jamais mélanger deux utilisateurs.

import { me } from './supabase'

const isNetworkError = (e: unknown) =>
  (typeof navigator !== 'undefined' && navigator.onLine === false) ||
  /fetch|network|load failed|internet|offline|timed out/i.test(String((e as { message?: string })?.message ?? e))

export async function offlineCached<T>(
  name: string,
  load: () => Promise<T>,
  codec: { save: (v: T) => unknown; restore: (raw: unknown) => T } = { save: (v) => v, restore: (r) => r as T },
): Promise<T> {
  const key = `zapping.offline.${name}.${await me().catch(() => 'anon')}`
  try {
    const value = await load()
    try {
      localStorage.setItem(key, JSON.stringify(codec.save(value)))
    } catch {
      /* stockage plein : pas de copie cette fois */
    }
    return value
  } catch (e) {
    if (isNetworkError(e)) {
      try {
        const raw = localStorage.getItem(key)
        if (raw) return codec.restore(JSON.parse(raw))
      } catch {
        /* copie illisible */
      }
    }
    throw e
  }
}

/** Map<number, Map<number, string | null>> ↔ JSON. */
export const nestedMapCodec = {
  save: (m: Map<number, Map<number, string | null>>) => [...m.entries()].map(([k, v]) => [k, [...v.entries()]]),
  restore: (raw: unknown) =>
    new Map((raw as [number, [number, string | null][]][]).map(([k, v]) => [k, new Map(v)])) as Map<number, Map<number, string | null>>,
}
