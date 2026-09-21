// Suggestions refusées (« Non, ne plus proposer ») dans Recommandé pour toi.
// Persisté en localStorage plutôt qu'en base : c'est une préférence
// d'affichage locale, pas une donnée de visionnage.

const KEY = 'zapping:dismissed-recs'

type Kind = 'movie' | 'show'
type Store = { movie: number[]; show: number[] }

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as Store
  } catch {
    /* cache illisible : on repart à zéro */
  }
  return { movie: [], show: [] }
}

function save(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* stockage plein : pas grave */
  }
}

export function isDismissed(kind: Kind, id: number): boolean {
  return load()[kind].includes(id)
}

export function dismiss(kind: Kind, id: number): void {
  const s = load()
  if (!s[kind].includes(id)) s[kind].push(id)
  save(s)
}
