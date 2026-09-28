// TVmaze est tenu par sa communauté : il lui manque parfois des dates
// d'épisodes (saison mise en ligne d'un bloc) ou une saison entière. TMDB,
// qu'on interroge déjà pour le français, les connaît souvent : on complète la
// fiche TVmaze avec, sans jamais rien écraser de ce que TVmaze sait.
//
// Un épisode connu seulement de TMDB reçoit un identifiant négatif (-id TMDB) :
// il ne peut pas se confondre avec un épisode TVmaze, et reste le même d'une
// fois sur l'autre (on peut donc le cocher). Si TVmaze l'ajoute plus tard,
// l'épisode TVmaze prend sa place.

import { tvEpisodesOutline, type TmdbEpisode } from './tmdb'
import { storeShow, type ShowWithEpisodes, type TvEpisode } from './tvmaze'

/** Vrai si la fiche vient d'être complétée ; la nouvelle fiche est en cache. */
export async function completeFromTmdb(data: ShowWithEpisodes): Promise<ShowWithEpisodes | null> {
  const imdb = data.show.externals?.imdb ?? null
  const year = data.show.premiered ? Number(data.show.premiered.slice(0, 4)) : null
  // TMDB est gardé 3 jours sur l'appareil : le réseau n'est sollicité qu'alors.
  const outline = await tvEpisodesOutline(imdb, { name: data.show.name, year }).catch(() => null)
  if (!outline?.length) return null
  const next = mergeOutline(data, outline)
  if (next) storeShow(data.show.id, next)
  return next
}

/** La fiche TVmaze complétée par TMDB, ou null si rien ne change. */
export function mergeOutline(data: ShowWithEpisodes, outline: TmdbEpisode[]): ShowWithEpisodes | null {
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
  // TMDB et TVmaze ne découpent pas toujours les saisons pareil (Lupin : les
  // parties 1 et 2 forment une seule saison chez TMDB, deux chez TVmaze, comme
  // chez Netflix). On garde donc toujours le découpage de TVmaze et on ne prend
  // chez TMDB que ce qui sort après son dernier épisode daté (la saison 2 de
  // Flashback), ou ce qui manque d'un bloc sorti ce jour-là (Lupin partie 4 :
  // 8 épisodes le même jour, TVmaze n'en connaît qu'un).
  const dated = episodes.filter((e) => e.airdate)
  const last = dated.reduce((m, e) => (e.airdate > m ? e.airdate : m), '')
  const maxSeason = Math.max(0, ...episodes.map((e) => e.season))
  const synth = (t: (typeof outline)[number], season: number, number: number): TvEpisode => ({
    id: -t.id,
    season,
    number,
    name: t.name ?? `Épisode ${number}`,
    airdate: t.airdate ?? '',
    airstamp: null,
    runtime: t.runtime,
    summary: t.overview,
    image: null,
  })

  if (last) {
    const sameDayTvm = episodes.filter((e) => e.airdate === last)
    const sameDayTmdb = outline.filter((t) => t.airdate === last)
    if (sameDayTmdb.length > sameDayTvm.length) {
      const season = Math.max(...sameDayTvm.map((e) => e.season))
      let number = Math.max(...episodes.filter((e) => e.season === season).map((e) => e.number))
      for (const t of sameDayTmdb.slice(sameDayTvm.length)) {
        episodes.push(synth(t, season, ++number))
        changed = true
      }
    }
  }
  // Décalage des numéros de saison entre les deux (Lupin : +1 depuis la partie 2).
  const anchorTvm = episodes.filter((e) => e.airdate === last).map((e) => e.season)
  const anchorTmdb = outline.filter((t) => t.airdate === last).map((t) => t.season)
  const shift = anchorTvm.length && anchorTmdb.length ? Math.max(...anchorTvm) - Math.max(...anchorTmdb) : 0
  for (const t of outline) {
    const later = t.airdate ? last && t.airdate > last : t.season + shift > maxSeason
    if (!later || byKey.has(key(t.season + shift, t.number))) continue
    changed = true
    episodes.push(synth(t, t.season + shift, t.number))
  }
  const hadSynthetic = data.episodes.some((e) => e.id < 0)
  if (!changed && !hadSynthetic) return null
  episodes.sort((a, b) => a.season - b.season || a.number - b.number)
  return { ...data, episodes }
}
