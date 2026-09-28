// Reprise en masse : on lit une liste « Série S05E08 » et on en déduit
// les épisodes à cocher. Voir le composant Import.

import type { TvEpisode } from './tvmaze'

export type ParsedLine = {
  raw: string
  title: string
  season: number | null
  number: number | null
  /** Date de visionnage optionnelle, « @ 12/03/2024 » en fin de ligne (ISO court). */
  date: string | null
}

/** Détache un « @ 2024-03-12 » ou « @ 12/03/2024 » de fin de ligne. */
function takeDate(line: string): { rest: string; date: string | null } {
  const m = /\s*@\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\s*$/.exec(line)
  if (!m) return { rest: line, date: null }
  const rest = line.slice(0, m.index).trim()
  if (/^\d{4}-/.test(m[1])) return { rest, date: m[1] }
  const [d, mo, y] = m[1].split(/[/.-]/).map(Number)
  const year = y < 100 ? y + 2000 : y
  const pad = (n: number) => String(n).padStart(2, '0')
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { rest, date: null }
  return { rest, date: `${year}-${pad(mo)}-${pad(d)}` }
}

const SxxExx = /^(.+?)\s+s\s*(\d{1,3})\s*e\s*(\d{1,4})$/i
const NxNN = /^(.+?)\s+(\d{1,2})\s*x\s*(\d{1,4})$/i
const Sxx = /^(.+?)\s+s\s*(\d{1,3})$/i

/**
 * « Breaking Bad S05E08 », « Severance 2x04 », « The Office S03 » ou juste « Dark ».
 * Une date de visionnage peut suivre : « The Boys S01E08 @ 12/03/2024 ».
 */
export function parseLine(raw: string): ParsedLine | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const { rest: line, date } = takeDate(trimmed)
  if (!line) return null

  for (const re of [SxxExx, NxNN]) {
    const m = re.exec(line)
    if (m) return { raw: trimmed, title: m[1].trim(), season: Number(m[2]), number: Number(m[3]), date }
  }
  const m = Sxx.exec(line)
  if (m) return { raw: trimmed, title: m[1].trim(), season: Number(m[2]), number: null, date }

  return { raw: trimmed, title: line, season: null, number: null, date }
}

export function parseList(text: string): ParsedLine[] {
  return text.split('\n').map(parseLine).filter((l): l is ParsedLine => l !== null)
}

/**
 * Tous les épisodes jusqu'au point indiqué, inclus. Une saison sans numéro
 * signifie « saison terminée ». Sans saison, rien à cocher : on suit la série.
 */
export function episodesUpTo(
  episodes: TvEpisode[],
  season: number | null,
  number: number | null,
): TvEpisode[] {
  if (season === null) return []
  return episodes.filter(
    (e) => e.season < season || (e.season === season && (number === null || e.number <= number)),
  )
}

export function describeTarget(season: number | null, number: number | null): string {
  if (season === null) return 'série suivie, aucun épisode coché'
  if (number === null) return `tout jusqu'à la fin de la saison ${season}`
  return `tout jusqu'à S${String(season).padStart(2, '0')}E${String(number).padStart(2, '0')}`
}
