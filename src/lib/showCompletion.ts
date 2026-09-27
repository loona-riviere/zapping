// TVmaze est tenu par sa communauté : il lui manque parfois des dates
// d'épisodes (saison mise en ligne d'un bloc) ou une saison entière. TMDB,
// qu'on interroge déjà pour le français, les connaît souvent : on complète la
// fiche TVmaze avec, sans jamais rien écraser de ce que TVmaze sait.
//
// Un épisode connu seulement de TMDB reçoit un identifiant négatif (-id TMDB) :
// il ne peut pas se confondre avec un épisode TVmaze, et reste le même d'une
// fois sur l'autre (on peut donc le cocher). Si TVmaze l'ajoute plus tard,
// l'épisode TVmaze prend sa place.

import { tvEpisodesOutline } from './tmdb'
import { storeShow, type ShowWithEpisodes, type TvEpisode } from './tvmaze'

/** Vrai si la fiche vient d'être complétée ; la nouvelle fiche est en cache. */
export async function completeFromTmdb(data: ShowWithEpisodes): Promise<ShowWithEpisodes | null> {
  const imdb = data.show.externals?.imdb ?? null
  const year = data.show.premiered ? Number(data.show.premiered.slice(0, 4)) : null
  // TMDB est gardé 3 jours sur l'appareil : le réseau n'est sollicité qu'alors.
  const outline = await tvEpisodesOutline(imdb, { name: data.show.name, year }).catch(() => null)
  if (!outline?.length) return null

  const key = (s: number, n: number) => `${s}:${n}`
  const byKey = new Map(data.episodes.filter((e) => e.id > 0).map((e) => [key(e.season, e.number), e]))
  let changed = false
  const episodes: TvEpisode[] = data.episodes.filter((e) => e.id > 0).map((e) => {
    const t = outline.find((o) => o.season === e.season && o.number === e.number)
    if (!e.airdate && t?.airdate) {
      changed = true
      return { ...e, airdate: t.airdate, airstamp: null }
    }
    return e
  })
  for (const t of outline) {
    if (byKey.has(key(t.season, t.number))) continue
    changed = true
    episodes.push({
      id: -t.id,
      season: t.season,
      number: t.number,
      name: t.name ?? `Épisode ${t.number}`,
      airdate: t.airdate ?? '',
      airstamp: null,
      runtime: t.runtime,
      summary: t.overview,
      image: null,
    })
  }
  const hadSynthetic = data.episodes.some((e) => e.id < 0)
  if (!changed && !hadSynthetic) return null
  episodes.sort((a, b) => a.season - b.season || a.number - b.number)
  const next = { ...data, episodes }
  storeShow(data.show.id, next)
  return next
}
