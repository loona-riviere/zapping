// Reprise en masse : on lit une liste « Série S05E08 » et on en déduit
// les épisodes à cocher. Voir le composant Import.

import type { TvEpisode } from './tvmaze'

export type ParsedLine = {
  raw: string
  title: string
  season: number | null
  number: number | null
}

const SxxExx = /^(.+?)\s+s\s*(\d{1,3})\s*e\s*(\d{1,4})$/i
const NxNN = /^(.+?)\s+(\d{1,2})\s*x\s*(\d{1,4})$/i
const Sxx = /^(.+?)\s+s\s*(\d{1,3})$/i

/** « Breaking Bad S05E08 », « Severance 2x04 », « The Office S03 » ou juste « Dark ». */
export function parseLine(raw: string): ParsedLine | null {
  const line = raw.trim()
  if (!line) return null

  for (const re of [SxxExx, NxNN]) {
    const m = re.exec(line)
    if (m) return { raw: line, title: m[1].trim(), season: Number(m[2]), number: Number(m[3]) }
  }
  const m = Sxx.exec(line)
  if (m) return { raw: line, title: m[1].trim(), season: Number(m[2]), number: null }

  return { raw: line, title: line, season: null, number: null }
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
