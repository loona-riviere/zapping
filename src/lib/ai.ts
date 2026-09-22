import type { TrackedShow, WatchedMovie, DismissedRec } from './store'
import { supabase } from './supabase'

/** Un titre proposé à Gemini : il ne peut choisir que parmi ceux-là. */
export type AiCandidate = {
  id: number
  title: string
  originalTitle?: string
  year: number | null
  genreIds: number[]
  overview?: string | null
  vote?: number
  /** Contexte affiché aussi à l'écran, par ex. « Top 10 Netflix n°3 ». */
  tag?: string
}

export type AiPick<T> = { item: T; reason: string; tag?: string }

// Deux niveaux de cache : 6 h sur l'appareil (pas même un appel réseau), et
// 24 h en base côté serveur (partagé entre l'icône et Safari). Gemini n'est
// interrogé qu'au plus une fois par jour et par type, et seulement les jours
// où l'app est ouverte.
const LOCAL_TTL = 6 * 60 * 60 * 1000

export type AiResult<T> = { picks: AiPick<T>[]; generatedAt: string }

const cacheKey = (kind: 'show' | 'movie') => `zapping:ai:v2:${kind}`

function readLocal<T>(kind: 'show' | 'movie'): AiResult<T> | null {
  try {
    const raw = localStorage.getItem(cacheKey(kind))
    if (!raw) return null
    const c = JSON.parse(raw) as { at: number } & AiResult<T>
    return Date.now() - c.at < LOCAL_TTL ? c : null
  } catch {
    return null
  }
}

function writeLocal<T>(kind: 'show' | 'movie', r: AiResult<T>) {
  try {
    localStorage.setItem(cacheKey(kind), JSON.stringify({ at: Date.now(), ...r }))
  } catch {
    /* stockage plein : on redemandera au serveur */
  }
}

async function call<T>(body: object): Promise<AiResult<T> & { stale?: boolean; error?: string }> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('non connectée')
  const res = await fetch('/api/ai-recommendations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as AiResult<T> & { stale?: boolean; error?: string }
  if (!res.ok) throw new Error(json.error ?? `réponse ${res.status}`)
  return json
}

/**
 * La dernière sélection encore valable, sans jamais déclencher Gemini.
 * `stale` : pas de sélection, ou trop ancienne — à regénérer.
 */
export async function loadAiPicks<T>(kind: 'show' | 'movie'): Promise<{ result: AiResult<T> | null; stale: boolean }> {
  const local = readLocal<T>(kind)
  if (local) return { result: local, stale: false }
  const r = await call<T>({ kind, mode: 'cached' })
  const result = r.picks ? { picks: r.picks, generatedAt: r.generatedAt } : null
  if (result && !r.stale) writeLocal(kind, result)
  return { result, stale: !!r.stale }
}

/**
 * Demande à Gemini (via la fonction Netlify, la clé reste côté serveur) de
 * choisir et d'expliquer, parmi `pool`, ce qui lui plaira le plus. Le
 * serveur renvoie la sélection en base si elle est encore fraîche.
 */
export async function generateAiPicks<T>(
  kind: 'show' | 'movie',
  library: string[],
  dismissed: string[],
  pool: { item: T; cand: AiCandidate }[],
  force = false,
): Promise<AiResult<T> & { error?: string }> {
  const r = await call<T>({
    kind,
    mode: 'generate',
    force,
    library,
    dismissed,
    candidates: pool.map((p) => ({ ...p.cand, item: p.item })),
  })
  const result = { picks: r.picks ?? [], generatedAt: r.generatedAt }
  if (result.picks.length) writeLocal(kind, result)
  return { ...result, error: r.error }
}

const SHOW_STATUS: Record<TrackedShow['status'], string> = {
  watching: 'suivie',
  paused: 'en pause',
  later: 'à voir, pas commencée',
  dropped: 'abandonnée',
}
const RATING: Record<string, string> = { love: 'adorée', like: 'aimée', dislike: 'pas aimée' }

/** Ce que Gemini sait de ses goûts : tout, séries et films, avec son avis. */
export function libraryLines(tracked: TrackedShow[], movies: WatchedMovie[]): string[] {
  const shows = tracked.map((t) => {
    const bits = [SHOW_STATUS[t.status]]
    if (t.rating) bits.push(RATING[t.rating])
    if (t.rewatches > 0) bits.push(`revue en entier ${t.rewatches} fois`)
    return `Série : ${t.name} — ${bits.join(', ')}`
  })
  const films = movies.map((m) => {
    const bits = [m.status === 'watched' ? 'vu' : 'à voir']
    if (m.rating) bits.push(RATING[m.rating].replace(/e$/, ''))
    return `Film : ${m.title}${m.release_year ? ` (${m.release_year})` : ''} — ${bits.join(', ')}`
  })
  return [...shows, ...films]
}

export const dismissedNames = (dismissed: DismissedRec[]) => dismissed.map((d) => d.name)
