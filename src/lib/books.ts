// Catalogue des livres. Deux sources, aucune obligatoire :
//   — Google Books, meilleure couverture des éditions françaises, mais qui
//     refuse désormais les requêtes sans clé (quota à 0) : on ne l'appelle que
//     si VITE_GOOGLE_BOOKS_KEY est posée ;
//   — Open Library, gratuite et sans clé, en repli (et quand Google échoue).
//
// Un identifiant porte sa source en préfixe (« gb:zyTCAlFPjgYC »,
// « ol:OL45883W ») : la fiche détail sait ainsi où aller le chercher, et deux
// sources ne peuvent jamais se marcher dessus en base.

export type Book = {
  id: string
  title: string
  authors: string[]
  cover_url: string | null
  page_count: number | null
  year: number | null
  description: string | null
  categories: string[]
}

const GB_KEY = import.meta.env.VITE_GOOGLE_BOOKS_KEY
export const googleBooksConfigured = Boolean(GB_KEY)

/**
 * Les résultats de recherche déjà vus : une fiche ouverte depuis la recherche
 * s'affiche aussitôt, et garde le nombre de pages qu'Open Library ne donne
 * que dans ses résultats de recherche, pas sur la fiche de l'œuvre.
 */
const seen = new Map<string, Book>()

function remember(books: Book[]): Book[] {
  for (const b of books) {
    const known = seen.get(b.id)
    seen.set(b.id, known ? { ...known, ...b, page_count: b.page_count ?? known.page_count } : b)
  }
  return books
}

export async function searchBooks(query: string): Promise<Book[]> {
  const exact = await searchOnce(query)
  if (exact.length) return remember(exact)

  // Rien tel quel : souvent une faute sur le nom de l'auteur (« Lila » pour
  // « Lilia »), ou une dictée qui coupe un nom en deux (« has saine » pour
  // « Hassaine »). On retente avec des variantes — un mot en moins, deux mots
  // voisins recollés — puis on garde en tête ce qui colle au plus de mots
  // tapés, pour que « Panorama » seul ne noie pas le bon livre.
  const words = query.trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) return []
  const merged: string[][] = []
  for (let i = 0; i < words.length - 1; i++) {
    merged.push([...words.slice(0, i), words[i] + words[i + 1], ...words.slice(i + 2)])
  }
  const dropOne = (ws: string[]) =>
    ws.map((_, i) => ws.filter((__, j) => j !== i)).filter((r) => r.join('').length >= 3)
  // Recollés d'abord, puis recollés avec un mot en moins, puis un mot en moins.
  const variants = new Set<string>(
    [...merged, ...merged.flatMap(dropOne), ...dropOne(words)].map((ws) => ws.join(' ')),
  )
  // En dernier recours, chaque mot assez long seul (souvent le titre) : deux
  // fautes dans le nom de l'auteur ne laissent que lui de fiable.
  for (const w of words) if (w.length >= 4) variants.add(w)
  const batches = await Promise.all(
    [...variants].slice(0, 14).map((v) => searchOnce(v).catch(() => [] as Book[])),
  )
  const byId = new Map<string, Book>()
  for (const b of batches.flat()) if (!byId.has(b.id)) byId.set(b.id, b)

  const tokens = new Set(words.map(fold))
  for (let i = 0; i < words.length - 1; i++) tokens.add(fold(words[i] + words[i + 1]))
  // Un mot tapé colle à un mot du livre à une ou deux lettres près :
  // « Hassaibe » retrouve « Hassaine », « Lila » retrouve « Lilia ».
  const score = (b: Book) => {
    const hayWords = `${b.title} ${b.authors.join(' ')}`.split(/[\s,.'’-]+/).map(fold).filter(Boolean)
    const hay = hayWords.join('')
    return [...tokens].filter((t) => {
      if (t.length < 3) return false
      if (hay.includes(t)) return true
      const tolerance = t.length >= 7 ? 2 : t.length >= 4 ? 1 : 0
      return tolerance > 0 && hayWords.some((w) => Math.abs(w.length - t.length) <= tolerance && editDistance(w, t) <= tolerance)
    }).length
  }
  return remember(
    [...byId.values()]
      .map((b, i) => ({ b, i, s: score(b) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, 20)
      .map((x) => x.b),
  )
}

/** Nombre de lettres à changer, ajouter ou retirer pour passer d'un mot à l'autre. */
function editDistance(a: string, b: string): number {
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

/** Sans accents ni casse ni espaces : « Has Saine » et « Hassaine » se retrouvent. */
const fold = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Une recherche : Google si la clé est là et qu'il trouve, sinon Open Library. */
async function searchOnce(query: string): Promise<Book[]> {
  if (GB_KEY) {
    try {
      const found = await searchGoogle(query)
      if (found.length) return found
    } catch {
      /* quota, clé invalide, réseau : Open Library prend le relais */
    }
  }
  return searchOpenLibrary(query)
}

export async function bookDetails(id: string): Promise<Book | null> {
  const known = seen.get(id)
  // Une fiche déjà complète (Google donne tout dès la recherche) n'a pas
  // besoin d'une seconde requête.
  if (known?.description) return known
  // Livre ajouté à la main : rien à aller chercher, tout est déjà en base.
  if (id.startsWith('manual:')) return known ?? null
  const [source, raw] = splitId(id)
  const details = source === 'gb' ? await googleDetails(raw) : await openLibraryDetails(raw)
  if (!details) return known ?? null
  return remember([
    { ...details, page_count: details.page_count ?? known?.page_count ?? null, authors: details.authors.length ? details.authors : known?.authors ?? [] },
  ])[0]
}

/** Un livre que ni Google ni Open Library ne connaissent, saisi à la main. */
export function manualBook(title: string, author: string, pages: number | null): Book {
  const uid = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now())
  return {
    id: `manual:${uid}`,
    title: title.trim(),
    authors: author.trim() ? [author.trim()] : [],
    cover_url: null,
    page_count: pages && pages > 0 ? pages : null,
    year: null,
    description: null,
    categories: [],
  }
}

function splitId(id: string): ['gb' | 'ol', string] {
  const [source, ...rest] = id.split(':')
  return [source === 'gb' ? 'gb' : 'ol', rest.join(':')]
}

const yearOf = (date: string | number | undefined | null): number | null => {
  const m = String(date ?? '').match(/\d{4}/)
  return m ? Number(m[0]) : null
}

/** Les résumés arrivent parfois en HTML (Google) ou en Markdown léger (Open Library). */
function plainText(s: string | null | undefined): string | null {
  if (!s) return null
  const text = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text || null
}

/* ----------------------------------------------------------- Google Books -- */

type GoogleVolume = {
  id: string
  volumeInfo: {
    title?: string
    subtitle?: string
    authors?: string[]
    publishedDate?: string
    pageCount?: number
    description?: string
    categories?: string[]
    imageLinks?: { thumbnail?: string; smallThumbnail?: string }
  }
}

function fromGoogle(v: GoogleVolume): Book {
  const info = v.volumeInfo
  const cover = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null
  return {
    id: `gb:${v.id}`,
    title: info.title ?? 'Sans titre',
    authors: info.authors ?? [],
    // Google sert ses vignettes en http : bloquées en mixed content sur Netlify.
    cover_url: cover ? cover.replace(/^http:/, 'https:').replace('&edge=curl', '') : null,
    page_count: info.pageCount || null,
    year: yearOf(info.publishedDate),
    description: plainText(info.description),
    categories: info.categories ?? [],
  }
}

/**
 * Dernier refus de Google (clé restreinte à un autre domaine, API non
 * activée, quota…), gardé pour l'afficher : sans ça, le repli sur Open
 * Library est silencieux et on croit que la clé sert.
 */
export let googleBooksError: string | null = null

async function searchGoogle(query: string): Promise<Book[]> {
  const params = new URLSearchParams({ q: query, maxResults: '20', printType: 'books', key: GB_KEY! })
  const res = await fetch(`https://www.googleapis.com/books/v1/volumes?${params}`)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    googleBooksError = `${res.status} — ${body?.error?.message ?? 'refus sans explication'}`
    throw new Error(`Google Books ${res.status}`)
  }
  googleBooksError = null
  const body = (await res.json()) as { items?: GoogleVolume[] }
  return (body.items ?? []).map(fromGoogle)
}

async function googleDetails(id: string): Promise<Book | null> {
  const params = GB_KEY ? `?key=${encodeURIComponent(GB_KEY)}` : ''
  const res = await fetch(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(id)}${params}`)
  if (!res.ok) return null
  return fromGoogle((await res.json()) as GoogleVolume)
}

/* ----------------------------------------------------------- Open Library -- */

const OL = 'https://openlibrary.org'
const olCover = (coverId: number | undefined | null) =>
  coverId && coverId > 0 ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : null

type OpenLibraryDoc = {
  key: string
  title: string
  author_name?: string[]
  first_publish_year?: number
  cover_i?: number
  number_of_pages_median?: number
  subject?: string[]
}

async function searchOpenLibrary(query: string): Promise<Book[]> {
  const params = new URLSearchParams({
    q: query,
    limit: '20',
    // `lang` fait remonter le titre français d'une œuvre quand il existe.
    lang: 'fr',
    fields: 'key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject',
  })
  const res = await fetch(`${OL}/search.json?${params}`)
  if (!res.ok) throw new Error(`Open Library ${res.status}`)
  const body = (await res.json()) as { docs?: OpenLibraryDoc[] }
  return (body.docs ?? []).map((d) => ({
    id: `ol:${d.key.replace('/works/', '')}`,
    title: d.title,
    authors: d.author_name ?? [],
    cover_url: olCover(d.cover_i),
    page_count: d.number_of_pages_median ?? null,
    year: d.first_publish_year ?? null,
    description: null,
    categories: (d.subject ?? []).slice(0, 3),
  }))
}

type OpenLibraryWork = {
  title: string
  description?: string | { value: string }
  covers?: number[]
  first_publish_date?: string
  subjects?: string[]
  authors?: { author: { key: string } }[]
}

async function openLibraryDetails(workId: string): Promise<Book | null> {
  const res = await fetch(`${OL}/works/${encodeURIComponent(workId)}.json`)
  if (!res.ok) return null
  const w = (await res.json()) as OpenLibraryWork
  const authorKeys = (w.authors ?? []).slice(0, 3).map((a) => a.author.key)
  const authors = await Promise.all(
    authorKeys.map((k) =>
      fetch(`${OL}${k}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<{ name?: string }>) : null))
        .then((a) => a?.name ?? null)
        .catch(() => null),
    ),
  )
  const description = typeof w.description === 'string' ? w.description : w.description?.value
  return {
    id: `ol:${workId}`,
    title: w.title,
    authors: authors.filter((a): a is string => !!a),
    cover_url: olCover(w.covers?.find((c) => c > 0)),
    page_count: null,
    year: yearOf(w.first_publish_date),
    description: plainText(description),
    categories: (w.subjects ?? []).slice(0, 3),
  }
}
