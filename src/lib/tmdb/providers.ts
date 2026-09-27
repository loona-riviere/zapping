// Où regarder : plateformes par abonnement (données JustWatch via TMDB).
import { KEY, get } from './client'
import { resolveTvId } from './tv'

export type Provider = { id: number; name: string; logo: string | null }
export type Availability = { providers: Provider[]; link: string | null }

const LOGO = 'https://image.tmdb.org/t/p/w92'
const AVAIL_TTL = 7 * 24 * 60 * 60 * 1000 // 7 j : une offre change, mais pas tous les jours

type RawProvider = { provider_id: number; provider_name: string; logo_path: string | null }

/**
 * Où regarder une série, en abonnement, dans un pays donné.
 *
 * On ne suit les séries que par leur identifiant TVmaze : le pont vers TMDB
 * passe par l'IMDb, que TVmaze publie dans `externals`. Sans IMDb, pas de
 * disponibilité — on renvoie null plutôt que de deviner sur le titre, qui
 * rapprocherait des homonymes.
 *
 * Les données viennent de JustWatch via TMDB, à créditer comme telles.
 */
export async function watchProviders(
  imdbId: string | null | undefined,
  region = 'FR',
): Promise<Availability | null> {
  if (!KEY || !imdbId) return null
  return cachedProviders(`tmdb:where:${region}:${imdbId}`, region, async () => {
    const tvId = await resolveTvId(imdbId)
    return tvId ? `/tv/${tvId}/watch/providers` : null
  })
}

/** Où regarder un film, en abonnement : même source, directement par son identifiant TMDB. */
export async function movieWatchProviders(movieId: number, region = 'FR'): Promise<Availability | null> {
  if (!KEY) return null
  return cachedProviders(`tmdb:where:${region}:movie:${movieId}`, region, async () => `/movie/${movieId}/watch/providers`)
}

async function cachedProviders(key: string, region: string, path: () => Promise<string | null>): Promise<Availability | null> {
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const cached = JSON.parse(raw) as { at: number; data: Availability | null }
      if (Date.now() - cached.at < AVAIL_TTL) return cached.data
    }
  } catch {
    /* cache illisible : on refetch */
  }

  let data: Availability | null = null
  const p = await path()
  if (p) {
    const res = await get<{
      results: Record<string, { link?: string; flatrate?: RawProvider[] }>
    }>(p, {})
    const here = res.results?.[region]
    if (here?.flatrate?.length) {
      data = {
        providers: here.flatrate.map((x) => ({
          id: x.provider_id,
          name: x.provider_name,
          logo: x.logo_path ? LOGO + x.logo_path : null,
        })),
        link: here.link ?? null,
      }
    }
  }

  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }))
  } catch {
    /* stockage plein : pas grave */
  }
  return data
}

