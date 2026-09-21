// Lecture d'un export « Historique de visionnage » Netflix (Compte → Profil →
// Activité de visionnage → Télécharger tout). Le fichier a deux colonnes,
// Title et Date, et un titre ressemble à :
//
//   "Friends: Saison 5: Celui qui jouait à la balle"   → série, saison connue
//   "Les Lionnes: Danse avec les lionnes"              → série, saison inconnue
//   "Enola Holmes 2"                                   → film
//
// Rien ici ne touche au réseau : ces fonctions sont pures et testables.

import type { TvEpisode } from './tvmaze'

export type NetflixEntry = {
  raw: string
  show: string
  season: number | null
  episode: string | null
  date: string // ISO court, aaaa-mm-jj
}

export type NetflixGroup = {
  key: string
  /** Titre à chercher dans le catalogue. */
  title: string
  kind: 'show' | 'movie'
  entries: NetflixEntry[]
}

/* ------------------------------------------------------------------ CSV --- */

/** Découpe un CSV en lignes de champs, guillemets et virgules internes compris. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
      continue
    }
    if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((f) => f.trim()))
}

/**
 * Netflix exporte les dates au format de la langue du compte : 9/21/26 (m/j/aa)
 * ou 21/09/2026 (j/m/aaaa). On tranche sur l'ensemble du fichier : dès qu'une
 * première composante dépasse 12, c'est le jour.
 */
export function detectDayFirst(dates: string[]): boolean {
  for (const d of dates) {
    const m = /^(\d{1,2})\D(\d{1,2})\D(\d{2,4})$/.exec(d.trim())
    if (!m) continue
    if (Number(m[1]) > 12) return true
    if (Number(m[2]) > 12) return false
  }
  return false
}

export function parseDate(value: string, dayFirst: boolean): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const m = /^(\d{1,2})\D(\d{1,2})\D(\d{2,4})$/.exec(value.trim())
  if (!m) return null
  const day = Number(dayFirst ? m[1] : m[2])
  const month = Number(dayFirst ? m[2] : m[1])
  let year = Number(m[3])
  if (year < 100) year += year > 70 ? 1900 : 2000
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

/* --------------------------------------------------------------- titres --- */

const WORD_NUMBERS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8,
  neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15,
  seize: 16, one: 1, two: 2, three: 3, four: 4, five: 5, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
}

/** Minuscules, sans accent ni ponctuation : pour comparer deux titres. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const SEASON_WORDS = /^(?:saison|season|partie|part|volume|vol|livre|book|chapitre|chapter)\s*(\d{1,3})$/
const SEASON_SHORT = /^s\s*(\d{1,3})$/
const LIMITED = /^(?:serie limitee|limited series|mini serie|miniseries|serie evenement)$/

/** Le segment décrit-il une saison ? Renvoie son numéro, ou null. */
function seasonOf(segment: string, showPrefix: string): number | null {
  const n = normalize(segment)
  let m = SEASON_WORDS.exec(n) ?? SEASON_SHORT.exec(n)
  if (m) return Number(m[1])
  if (LIMITED.test(n)) return 1
  // « Stranger Things: Stranger Things 5: Chapitre un » → saison 5.
  const prefix = normalize(showPrefix)
  if (prefix) {
    m = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d{1,3})$`).exec(n)
    if (m) return Number(m[1])
  }
  return null
}

/** « Friends: Saison 5: Celui qui… » → show, saison, titre d'épisode. */
export function splitTitle(raw: string): { show: string; season: number | null; episode: string | null } {
  const segments = raw.split(/\s*:\s*/).map((s) => s.trim()).filter(Boolean)
  if (!segments.length) return { show: raw.trim(), season: null, episode: null }

  for (let i = 1; i < segments.length; i++) {
    const show = segments.slice(0, i).join(': ')
    const season = seasonOf(segments[i], segments[0])
    if (season !== null) {
      const episode = segments.slice(i + 1).join(': ')
      return { show, season, episode: episode || null }
    }
  }
  return {
    show: segments[0],
    season: null,
    episode: segments.slice(1).join(': ') || null,
  }
}

/** Numéro d'épisode déduit de son titre : « Episode 6 », « Chapitre huit ». */
export function episodeNumberFromTitle(title: string): number | null {
  const m = /^(?:episode|chapitre|chapter|ep|partie|part)\s+(\S+)/.exec(normalize(title))
  if (!m) return null
  const n = Number(m[1])
  if (Number.isFinite(n) && n > 0) return n
  return WORD_NUMBERS[m[1]] ?? null
}

/* -------------------------------------------------------------- lecture --- */

/**
 * Lit le CSV et regroupe par œuvre. Un groupe d'une seule ligne sans marqueur
 * de saison est proposé comme film ; tout le reste comme série.
 */
export function parseNetflixCsv(text: string): { groups: NetflixGroup[]; skipped: number } {
  const rows = parseCsv(text)
  if (!rows.length) return { groups: [], skipped: 0 }

  const head = rows[0].map((h) => normalize(h))
  const start = head.includes('title') ? 1 : 0
  const titleAt = Math.max(0, head.indexOf('title'))
  const dateAt = head.indexOf('date') === -1 ? 1 : head.indexOf('date')

  const body = rows.slice(start)
  const dayFirst = detectDayFirst(body.map((r) => r[dateAt] ?? ''))

  const buckets = new Map<string, NetflixEntry[]>()
  let skipped = 0

  for (const row of body) {
    const raw = (row[titleAt] ?? '').trim()
    const date = parseDate(row[dateAt] ?? '', dayFirst)
    if (!raw || !date) { skipped++; continue }
    const { show, season, episode } = splitTitle(raw)
    const key = normalize(show.split(/\s*:\s*/)[0])
    if (!key) { skipped++; continue }
    const entry: NetflixEntry = { raw, show, season, episode, date }
    const list = buckets.get(key)
    if (list) list.push(entry)
    else buckets.set(key, [entry])
  }

  const groups: NetflixGroup[] = []
  for (const [key, entries] of buckets) {
    const solo = entries.length === 1 && entries[0].season === null
    groups.push({
      key,
      kind: solo ? 'movie' : 'show',
      title: solo ? entries[0].raw : showTitleFor(entries),
      entries,
    })
  }
  // Les plus gros groupes d'abord : ce sont ceux qui comptent le plus.
  groups.sort((a, b) => b.entries.length - a.entries.length || a.title.localeCompare(b.title))
  return { groups, skipped }
}

/**
 * Nom de série d'un groupe. Les lignes sans saison gardent parfois un sous-titre
 * dans le nom (« Anthracite: Le mystère de la secte des Écrins ») : on conserve
 * le plus long préfixe commun à toutes les lignes, qui est le vrai titre.
 */
function showTitleFor(entries: NetflixEntry[]): string {
  const parts = entries.map((e) => e.show.split(/\s*:\s*/).map((s) => s.trim()))
  let common = parts[0]
  for (const p of parts.slice(1)) {
    let i = 0
    while (i < common.length && i < p.length && normalize(common[i]) === normalize(p[i])) i++
    common = common.slice(0, i)
  }
  return (common.length ? common : parts[0].slice(0, 1)).join(': ')
}

/* ----------------------------------------------------------- rattachement -- */

export type Resolution = {
  /** Épisodes à cocher, avec la date de visionnage retenue. */
  picks: { episode: TvEpisode; date: string }[]
  /** 'exact' : chaque ligne appariée par son titre. 'approx' : par comptage. */
  mode: 'exact' | 'approx'
  /** Lignes du CSV sans épisode correspondant dans le catalogue. */
  leftover: number
}

const latest = (a: string, b: string) => (a > b ? a : b)

/** Dédoublonne les revisionnages d'un même épisode en gardant la date la plus récente. */
function dedupe(entries: NetflixEntry[]): { title: string; date: string }[] {
  const map = new Map<string, { title: string; date: string }>()
  entries.forEach((e, i) => {
    const title = e.episode ?? ''
    const k = normalize(title) || `#${i}`
    const seen = map.get(k)
    if (seen) seen.date = latest(seen.date, e.date)
    else map.set(k, { title, date: e.date })
  })
  return [...map.values()]
}

/**
 * Associe les lignes Netflix d'une saison aux épisodes du catalogue.
 * Netflix donne les titres traduits, TVmaze les titres d'origine : l'appariement
 * par nom ne marche que pour les séries francophones. Quand il échoue, on
 * retombe sur « N lignes vues → les N premiers épisodes de la saison ».
 */
function resolveBucket(entries: NetflixEntry[], pool: TvEpisode[]): Resolution {
  const wanted = dedupe(entries)
  if (!pool.length) return { picks: [], mode: 'approx', leftover: wanted.length }

  const byName = new Map<string, TvEpisode>()
  const byNumber = new Map<number, TvEpisode>()
  for (const ep of pool) {
    const n = normalize(ep.name)
    if (n && !byName.has(n)) byName.set(n, ep)
    if (!byNumber.has(ep.number)) byNumber.set(ep.number, ep)
  }

  const dates = new Map<number, string>() // episode.id → date
  let matched = 0
  for (const w of wanted) {
    const num = episodeNumberFromTitle(w.title)
    const ep = byName.get(normalize(w.title)) ?? (num !== null ? byNumber.get(num) : undefined)
    if (!ep) continue
    matched++
    const seen = dates.get(ep.id)
    dates.set(ep.id, seen ? latest(seen, w.date) : w.date)
  }

  if (matched === wanted.length) {
    const picks = pool
      .filter((e) => dates.has(e.id))
      .map((e) => ({ episode: e, date: dates.get(e.id)! }))
    return { picks, mode: 'exact', leftover: 0 }
  }

  // Comptage : les N premiers épisodes, plus ceux reconnus par leur titre.
  const count = Math.min(wanted.length, pool.length)
  const chosen = new Set(pool.slice(0, count).map((e) => e.id))
  dates.forEach((_, id) => chosen.add(id))
  const ordered = pool.filter((e) => chosen.has(e.id))

  // Les dates connues restent à leur épisode ; les autres sont réparties dans
  // l'ordre de diffusion sur les dates du CSV, triées de la plus ancienne.
  const free = wanted.map((w) => w.date).sort()
  const picks = ordered.map((episode, i) => ({
    episode,
    date: dates.get(episode.id) ?? free[Math.min(i, free.length - 1)],
  }))
  return { picks, mode: 'approx', leftover: Math.max(0, wanted.length - pool.length) }
}

/** Résout un groupe entier : chaque saison connue, puis les lignes sans saison. */
export function resolveGroup(group: NetflixGroup, episodes: TvEpisode[]): Resolution {
  const bySeason = new Map<number | null, NetflixEntry[]>()
  for (const e of group.entries) {
    const list = bySeason.get(e.season)
    if (list) list.push(e)
    else bySeason.set(e.season, [e])
  }

  const picks = new Map<number, { episode: TvEpisode; date: string }>()
  let mode: 'exact' | 'approx' = 'exact'
  let leftover = 0

  for (const [season, entries] of bySeason) {
    const pool = season === null ? episodes : episodes.filter((e) => e.season === season)
    const r = resolveBucket(entries, pool)
    if (r.mode === 'approx') mode = 'approx'
    leftover += r.leftover
    for (const p of r.picks) {
      const seen = picks.get(p.episode.id)
      if (seen) seen.date = latest(seen.date, p.date)
      else picks.set(p.episode.id, { ...p })
    }
  }

  const ordered = episodes.filter((e) => picks.has(e.id)).map((e) => picks.get(e.id)!)
  return { picks: ordered, mode, leftover }
}

/** Date la plus récente d'un groupe : sert à trier et à horodater la série. */
export function lastDate(group: NetflixGroup): string {
  return group.entries.reduce((max, e) => latest(max, e.date), group.entries[0].date)
}
