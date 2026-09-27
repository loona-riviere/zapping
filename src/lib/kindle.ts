// Import de l'historique Kindle, depuis l'archive « Demander vos données »
// d'Amazon (Kindle.zip). Deux fichiers suffisent :
//   — Kindle.UserUniqueTitlesCompleted : les livres terminés, avec leur date ;
//   — Kindle.reading-insights-sessions_with_adjustments : chaque séance de
//     lecture (titre, début, fin, durée), y compris des livres pas finis.
// Les titres sont bruts (noms de fichiers, « (French Edition) », site de
// téléchargement, prénom de l'expéditeur…) : on les nettoie avant de les
// chercher au catalogue, et on regroupe les doublons.

import { unzipSync, strFromU8 } from 'fflate'

export type KindleBook = {
  /** Titre nettoyé, et auteur quand l'archive le donne : de quoi chercher au catalogue. */
  query: string
  /** Titre tel qu'il apparaît dans l'archive (le plus long vu). */
  raw: string
  firstRead: string | null
  lastRead: string | null
  /** Date à laquelle Kindle a marqué le livre terminé, s'il l'a fait. */
  completedAt: string | null
  hours: number
  sessions: number
}

/** Découpe une ligne CSV (guillemets, virgules dans les champs). */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x !== '')) rows.push(row)
  const [head, ...body] = rows
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

/**
 * « Julien - Éric-Emmanuel Schmitt – La traversée des temps, tome 2  La
 * porte du ciel (2021) » → « La traversée des temps, tome 2 La porte du ciel
 * Éric-Emmanuel Schmitt ». Ce qui ne sert qu'à brouiller la recherche part :
 * éditions, années, sites, extensions, prénoms en tête.
 */
export function cleanTitle(raw: string): { title: string; author: string | null } {
  // NFC : l'archive écrit parfois « É » en deux caractères (E + accent).
  let t = raw
    .normalize('NFC')
    .replace(/\.(pdf|epub|mobi|azw3?)\b.*$/i, '')
    .replace(/\((?:[^()]*?(?:edition|édition|ebooks?\.club|pdfdrive|\.com|\.org)[^()]*?)\)/gi, '')
    .replace(/\(\s*\d+\s*\)/g, '')
    .replace(/\(\s*(19|20)\d{2}\s*\)/g, '')
    .replace(/^\s*\d+\s*[-–]\s*/, '')
    .replace(/_/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  let author: string | null = null
  // « Auteur – Titre » (tiret long), seulement si ce qui précède ressemble à
  // un nom de personne : « Cinquante Nuances de Grey – 3 Tomes » n'en est pas un.
  const parts = t.split(/\s+–\s+/)
  if (parts.length >= 2) {
    // Un prénom seul avant « - » (expéditeur de l'envoi vers Kindle) saute.
    const candidate = parts[0].replace(/^[A-ZÉ][a-zé]+\s+-\s+/, '')
    const looksLikeName =
      candidate.split(/\s+/).length <= 4 &&
      candidate.split(/\s+/).every((w) => /^[A-ZÉÈ][\p{L}.'-]*$/u.test(w)) &&
      !/\d/.test(candidate)
    if (looksLikeName) {
      author = candidate
      t = parts.slice(1).join(' ')
    } else t = parts.join(' ')
  }
  // Sous-titres marketing après « : » (« … : Le guide pratique pour… »).
  const colon = t.split(/\s*:\s+/)
  if (colon.length > 1 && colon[0].length >= 6) t = colon[0]
  return { title: t.replace(/\s{2,}/g, ' ').trim(), author }
}

/** Clé de regroupement : sans accents, casse, ponctuation ni mots creux. */
function keyOf(query: string): string {
  return query
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(le|la|les|l|the|de|des|du|tome|t)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const isJunk = (name: string) => !name || /^not (available|applicable)$/i.test(name)

/** Lit Kindle.zip et regroupe les lectures par livre, les plus récentes d'abord. */
export function readKindleZip(zip: Uint8Array): KindleBook[] {
  const files = unzipSync(zip, {
    filter: (f) => /UserUniqueTitlesCompleted\.csv$|reading-insights-sessions_with_adjustments\.csv$/.test(f.name),
  })
  const pick = (re: RegExp) => Object.entries(files).find(([name]) => re.test(name))?.[1]
  const completedFile = pick(/UserUniqueTitlesCompleted\.csv$/)
  const sessionsFile = pick(/sessions_with_adjustments\.csv$/)
  if (!completedFile && !sessionsFile) {
    throw new Error("Ce fichier ne ressemble pas à l'archive Kindle d'Amazon (Kindle.zip).")
  }

  const byKey = new Map<string, KindleBook>()
  const entry = (raw: string) => {
    const { title, author } = cleanTitle(raw)
    // Regroupé sur le titre seul : le même livre apparaît avec et sans auteur.
    const key = keyOf(title)
    const query = author ? `${title} ${author}` : title
    let b = byKey.get(key)
    if (!b) {
      b = { query, raw, firstRead: null, lastRead: null, completedAt: null, hours: 0, sessions: 0 }
      byKey.set(key, b)
    }
    if (query.length > b.query.length) b.query = query
    if (raw.length > b.raw.length) b.raw = raw
    return b
  }

  for (const r of sessionsFile ? parseCsv(strFromU8(sessionsFile)) : []) {
    if (isJunk(r.product_name)) continue
    const b = entry(r.product_name)
    b.sessions++
    b.hours += (Number(r.total_reading_milliseconds) || 0) / 3_600_000
    if (r.start_time && (!b.firstRead || r.start_time < b.firstRead)) b.firstRead = r.start_time
    if (r.end_time && (!b.lastRead || r.end_time > b.lastRead)) b.lastRead = r.end_time
  }
  for (const r of completedFile ? parseCsv(strFromU8(completedFile)) : []) {
    if (isJunk(r.product_name)) continue
    // « Not Applicable_2026-08-17_AUTOMATIC » : la date est au milieu.
    const date = r.asin_date_and_content_type?.match(/\d{4}-\d{2}-\d{2}/)?.[0]
    if (!date) continue
    const b = entry(r.product_name)
    const at = `${date}T12:00:00.000Z`
    if (!b.completedAt || at > b.completedAt) b.completedAt = at
  }

  return [...byKey.values()].sort((a, b) =>
    (b.completedAt ?? b.lastRead ?? '').localeCompare(a.completedAt ?? a.lastRead ?? ''),
  )
}
