// Recherche tolérante aux fautes de frappe, au-dessus de catalogues (TMDB,
// TVmaze, Google Books…) qui, eux, ne corrigent rien : une lettre de travers
// et ils ne renvoient rien, ou autre chose.
//
// Principe : on lance la recherche telle quelle ; si aucun résultat ne retrouve
// tous les mots tapés, on retente avec des variantes (mots recollés, un mot en
// moins, un mot seul, dernier mot tronqué), puis on classe l'ensemble selon le
// nombre de mots retrouvés à une ou deux lettres près.

/** Sans accents ni casse ni espaces : « Has Saine » et « Hassaine » se retrouvent. */
export const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Nombre de lettres à changer, ajouter ou retirer pour passer d'un mot à l'autre. */
export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/**
 * Combien de mots tapés un texte retrouve, à une ou deux lettres près :
 * « hypothesys » retrouve « Hypothesis », « has saine » recollé « Hassaine ».
 */
export function wordScorer(words: string[]): (text: string) => number {
  const tokens = new Set(words.map(fold))
  for (let i = 0; i < words.length - 1; i++) tokens.add(fold(words[i] + words[i + 1]))
  return (text: string) => {
    const hayWords = text.split(/[\s,.'’:-]+/).map(fold).filter(Boolean)
    const hay = hayWords.join('')
    return [...tokens].filter((t) => {
      if (t.length < 3) return false
      if (hay.includes(t)) return true
      const tolerance = t.length >= 7 ? 2 : t.length >= 4 ? 1 : 0
      return tolerance > 0 && hayWords.some((w) => Math.abs(w.length - t.length) <= tolerance && editDistance(w, t) <= tolerance)
    }).length
  }
}

/** Requêtes de secours, de la plus proche de la saisie à la plus lointaine. */
export function queryVariants(words: string[]): string[] {
  const merged: string[][] = []
  for (let i = 0; i < words.length - 1; i++) {
    merged.push([...words.slice(0, i), words[i] + words[i + 1], ...words.slice(i + 2)])
  }
  const dropOne = (ws: string[]) =>
    ws.map((_, i) => ws.filter((__, j) => j !== i)).filter((r) => r.join('').length >= 3)
  const out = new Set<string>(
    [...merged, ...merged.flatMap(dropOne), ...dropOne(words)].map((ws) => ws.join(' ')),
  )
  // Les catalogues cherchent souvent par préfixe sur le dernier mot : le tronquer
  // saute une faute à la fin (« hypothesys » → « hypothes »).
  const last = words[words.length - 1]
  if (last.length >= 6) out.add([...words.slice(0, -1), last.slice(0, -2)].join(' '))
  // Chaque mot assez long seul (souvent le titre).
  for (const w of words) if (w.length >= 4) out.add(w)
  return [...out].filter((q) => q.trim().toLowerCase() !== words.join(' ').toLowerCase())
}

/**
 * `searchOnce` fait une vraie recherche ; `textOf` donne le texte où retrouver
 * les mots tapés (titre, auteurs…) ; `idOf` sert à dédoublonner.
 */
export async function fuzzySearch<T>(
  query: string,
  searchOnce: (q: string) => Promise<T[]>,
  textOf: (item: T) => string,
  idOf: (item: T) => string | number,
  { maxVariants = 8, limit = 20 } = {},
): Promise<T[]> {
  const words = query.trim().split(/\s+/).filter(Boolean)
  const exact = await searchOnce(query)
  if (!words.length) return exact

  const score = wordScorer(words)
  // Un résultat qui retrouve tous les mots significatifs tapés est le bon :
  // inutile d'aller plus loin. Un résultat non vide ne suffit pas, certains
  // catalogues répondent toujours quelque chose.
  const wanted = words.filter((w) => fold(w).length >= 3).length
  if (exact.some((it) => score(textOf(it)) >= wanted)) return exact

  const batches = await Promise.all(
    queryVariants(words).slice(0, maxVariants).map((v) => searchOnce(v).catch(() => [] as T[])),
  )
  const byId = new Map<string | number, T>()
  for (const it of [...exact, ...batches.flat()]) if (!byId.has(idOf(it))) byId.set(idOf(it), it)

  const ranked = [...byId.values()]
    .map((it, i) => ({ it, i, s: score(textOf(it)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.it)
  // Rien ne colle à aucun mot : autant montrer ce que le catalogue proposait.
  return ranked.length ? ranked : exact
}
