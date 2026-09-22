import type { RecSignals } from './tmdb'

/**
 * Une liste de suggestions TMDB issue d'un titre de la bibliothèque. Poids
 * positif : un titre aimé (plus il est aimé, plus ses suggestions comptent).
 * Poids négatif : un titre pas aimé ou abandonné — ce que TMDB rapproche de
 * lui est pénalisé.
 */
export type SeedList<T> = { label: string; weight: number; items: T[] }

export type Ranked<T> = { item: T; because: string }

type Acc<T> = { item: T; score: number; mainSeed: string; mainContribution: number }

const thisYear = () => new Date().getFullYear()

/**
 * Croise les listes TMDB au lieu de garder l'ordre brut d'une seule :
 * - un titre suggéré par plusieurs séries/films aimés passe devant ;
 * - un titre proche de ce qu'on n'a pas aimé recule, voire disparaît ;
 * - les genres récurrents chez ce qu'on aime comptent un peu, ceux de ce
 *   qu'on n'aime pas pénalisent un peu ;
 * - la note TMDB et la récence départagent, sans exclure les classiques ;
 * - pas plus de quelques titres d'affilée tirés du même film/série de base.
 */
export function rankRecommendations<T extends RecSignals & { id: number; year: number | null }>(
  seeds: SeedList<T>[],
  exclude: (item: T) => boolean,
  limit = 20,
): Ranked<T>[] {
  const acc = new Map<number, Acc<T>>()
  const posGenres = new Map<number, number>()
  const negGenres = new Map<number, number>()
  let posTotal = 0
  let negTotal = 0

  for (const seed of seeds) {
    const n = seed.items.length
    seed.items.forEach((item, i) => {
      // TMDB trie ses suggestions par pertinence : la 1re vaut 1, la dernière 0,5.
      const contribution = seed.weight * (1 - (0.5 * i) / Math.max(n, 1))
      const genres = seed.weight > 0 ? posGenres : negGenres
      for (const g of item.genreIds) genres.set(g, (genres.get(g) ?? 0) + Math.abs(seed.weight))
      if (seed.weight > 0) posTotal += seed.weight * item.genreIds.length
      else negTotal += -seed.weight * item.genreIds.length

      const a = acc.get(item.id) ?? { item, score: 0, mainSeed: '', mainContribution: 0 }
      a.score += contribution
      if (contribution > a.mainContribution) {
        a.mainContribution = contribution
        a.mainSeed = seed.label
      }
      acc.set(item.id, a)
    })
  }

  const genreAffinity = (ids: number[]) => {
    if (!ids.length) return 0
    let sum = 0
    for (const g of ids) {
      const pos = posTotal ? (posGenres.get(g) ?? 0) / posTotal : 0
      const neg = negTotal ? (negGenres.get(g) ?? 0) / negTotal : 0
      sum += pos - neg
    }
    // Parts de genre de l'ordre de 0,05 à 0,3 : ramené à un bonus de ±1 environ.
    return (sum / ids.length) * 5
  }

  const now = thisYear()
  const scored = [...acc.values()]
    // Jamais suggéré par un titre aimé → pas une suggestion, même au score net positif.
    .filter((a) => a.mainContribution > 0 && !exclude(a.item))
    .map((a) => {
      const { vote, voteCount, year } = a.item
      const quality = Math.max(-0.6, Math.min(0.6, (vote - 6.8) * 0.4)) + (voteCount < 100 ? -0.3 : 0)
      const age = year ? now - year : 10
      // Léger, pas un filtre : TMDB ressort volontiers des grappes de vieilles
      // sitcoms américaines, mais un classique peut rester s'il est très suggéré.
      const recency = age <= 2 ? 0.35 : age <= 6 ? 0.15 : age >= 25 ? -0.4 : age >= 15 ? -0.2 : 0
      return { ...a, score: a.score + genreAffinity(a.item.genreIds) + quality + recency }
    })
    .filter((a) => a.score > 0)

  // Sélection gloutonne : chaque titre déjà tiré du même film/série de base
  // réduit les suivants de 35 % — sinon un seul coup de cœur remplit tout le
  // carrousel. Proportionnel plutôt que fixe : un « adoré » pèse 3 à 4 fois
  // plus qu'un simple « vu », une pénalité fixe ne l'arrêtait pas.
  const out: Ranked<T>[] = []
  const used = new Map<string, number>()
  const pool = [...scored]
  while (out.length < limit && pool.length) {
    let bestIdx = 0
    let bestScore = -Infinity
    pool.forEach((a, i) => {
      const s = a.score * 0.65 ** (used.get(a.mainSeed) ?? 0)
      if (s > bestScore) {
        bestScore = s
        bestIdx = i
      }
    })
    const [pick] = pool.splice(bestIdx, 1)
    used.set(pick.mainSeed, (used.get(pick.mainSeed) ?? 0) + 1)
    out.push({ item: pick.item, because: pick.mainSeed })
  }
  return out
}

/** Poids d'un titre aimé : l'avis explicite compte plus que le simple « vu ». */
export function seedWeight(rating: 'dislike' | 'like' | 'love' | null, recentDays: number | null): number {
  const base = rating === 'love' ? 3 : rating === 'like' ? 2 : 1
  // Vu ces deux derniers mois : les goûts du moment, un peu plus de poids.
  return recentDays !== null && recentDays <= 60 ? base * 1.3 : base
}

export const daysSince = (iso: string | null | undefined) =>
  iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : null

/** Exécute des tâches asynchrones deux par deux : ménage la limite de débit TMDB. */
export async function mapLimited<A, B>(items: A[], fn: (a: A) => Promise<B>, concurrency = 2): Promise<B[]> {
  const out: B[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return out
}
