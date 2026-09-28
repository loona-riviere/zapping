// File d'attente hors connexion : une écriture qui échoue faute de réseau
// (cocher un épisode, marquer un film vu, avancer sa page…) n'est pas annulée,
// elle est gardée sur l'appareil puis rejouée dans l'ordre au retour du réseau.
// Par compte : on ne rejoue que les écritures de la personne connectée.

import { me } from './supabase'

type Job = { op: string; args: unknown; uid: string; at: number }
type Codec<A extends unknown[]> = { save: (args: A) => unknown; restore: (raw: unknown) => A }

const KEY = 'zapping.queue'
const registry = new Map<string, { run: (...a: never[]) => Promise<unknown>; restore: (raw: unknown) => unknown[] }>()
let flushing = false

export const isNetworkError = (e: unknown) =>
  (typeof navigator !== 'undefined' && navigator.onLine === false) ||
  /fetch|network|load failed|internet|offline|timed out/i.test(String((e as { message?: string })?.message ?? e))

function read(): Job[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Job[]
  } catch {
    return []
  }
}
function write(jobs: Job[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(jobs))
  } catch {
    /* stockage plein : tant pis pour cette écriture */
  }
  window.dispatchEvent(new CustomEvent('zapping:queue', { detail: jobs.length }))
}

export const pendingCount = () => read().length

/**
 * Enveloppe une écriture : réseau absent → mise en file au lieu d'une erreur.
 * `codec` sert aux arguments non JSON (Map…).
 */
export function queueable<A extends unknown[]>(op: string, fn: (...args: A) => Promise<void>, codec?: Codec<A>) {
  const save = codec?.save ?? ((a: A) => a)
  const restore = codec?.restore ?? ((raw: unknown) => raw as A)
  registry.set(op, { run: fn as unknown as (...a: never[]) => Promise<unknown>, restore })
  return async (...args: A): Promise<void> => {
    const enqueue = async () => write([...read(), { op, args: save(args), uid: await me(), at: Date.now() }])
    // Des écritures attendent déjà : on passe derrière elles pour garder l'ordre.
    if ((typeof navigator !== 'undefined' && navigator.onLine === false) || read().length) {
      await enqueue()
      void flush()
      return
    }
    try {
      await fn(...args)
    } catch (e) {
      if (!isNetworkError(e)) throw e
      await enqueue()
    }
  }
}

/** Rejoue la file dans l'ordre ; s'arrête au premier échec réseau. */
export async function flush(): Promise<void> {
  if (flushing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
  flushing = true
  let done = 0
  try {
    const uid = await me().catch(() => null)
    for (;;) {
      const jobs = read()
      const next = jobs.find((j) => j.uid === uid)
      if (!next) break
      const entry = registry.get(next.op)
      try {
        if (entry) await entry.run(...(entry.restore(next.args) as never[]))
      } catch (e) {
        if (isNetworkError(e)) break
        console.warn('File hors ligne : écriture abandonnée', next.op, e)
      }
      const rest = read()
      const i = rest.findIndex((j) => j.at === next.at && j.op === next.op && j.uid === next.uid)
      if (i >= 0) rest.splice(i, 1)
      write(rest)
      done++
    }
  } finally {
    flushing = false
  }
  if (done) window.dispatchEvent(new CustomEvent('zapping:synced', { detail: done }))
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flush())
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void flush())
  setTimeout(() => void flush(), 3000)
}
