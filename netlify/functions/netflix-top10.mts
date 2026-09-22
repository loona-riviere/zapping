// Le vrai classement Netflix en France, à partir du fichier public que
// Netflix publie chaque semaine (https://www.netflix.com/tudum/top10).
// Récupéré côté serveur : pas d'en-têtes CORS pour un site tiers.
//
// Le fichier par pays ne donne qu'un rang 1 à 10 par semaine (pas de volume
// de vues). Le « top du mois » agrège les 4 dernières semaines : 10 points
// pour une 1re place, 1 pour une 10e, cumulés — un titre resté trois
// semaines dans le haut du classement passe devant un one-hit d'une semaine.
// Chaque semaine plus ancienne compte 10 % de moins : à place égale, ce qui
// cartonne maintenant passe devant ce qui cartonnait il y a un mois.
const DATA_URL = 'https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv'
const WEEKS = 4

type Entry = { title: string; points: number; bestRank: number; weekRank: number | null; weeks: number }

export default async () => {
  try {
    const res = await fetch(DATA_URL)
    if (!res.ok) {
      return Response.json({ error: `Netflix a répondu ${res.status}` }, { status: 502 })
    }
    const lines = (await res.text()).split('\n')
    const header = lines[0].split('\t').map((h) => h.trim())
    const col = (name: string) => header.indexOf(name)
    const iCountry = col('country_iso2')
    const iWeek = col('week')
    const iCategory = col('category')
    const iRank = col('weekly_rank')
    const iTitle = col('show_title')
    if ([iCountry, iWeek, iCategory, iRank, iTitle].some((i) => i < 0)) {
      return Response.json({ error: `Colonnes inattendues : ${header.join(', ')}` }, { status: 502 })
    }

    // Le fichier fait des dizaines de Mo : on ne découpe en colonnes que les
    // lignes françaises, repérées d'abord par un simple test de sous-chaîne.
    const rows: { week: string; category: string; rank: number; title: string }[] = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line.includes('\tFR\t')) continue
      const cells = line.split('\t').map((c) => c.trim())
      if (cells[iCountry] !== 'FR') continue
      rows.push({
        week: cells[iWeek],
        category: cells[iCategory],
        rank: Number(cells[iRank]),
        title: cells[iTitle],
      })
    }
    if (!rows.length) {
      return Response.json({ error: 'Aucune ligne France trouvée' }, { status: 502 })
    }

    const weeks = [...new Set(rows.map((r) => r.week))].sort().reverse().slice(0, WEEKS)
    const latest = weeks[0]

    const aggregate = (prefix: string) => {
      const byTitle = new Map<string, Entry>()
      for (const r of rows) {
        if (!r.category.startsWith(prefix) || !weeks.includes(r.week)) continue
        if (!(r.rank >= 1 && r.rank <= 10)) continue
        const e = byTitle.get(r.title) ?? { title: r.title, points: 0, bestRank: 11, weekRank: null, weeks: 0 }
        e.points += (11 - r.rank) * (1 - 0.1 * weeks.indexOf(r.week))
        e.bestRank = Math.min(e.bestRank, r.rank)
        e.weeks += 1
        if (r.week === latest) e.weekRank = r.rank
        byTitle.set(r.title, e)
      }
      return [...byTitle.values()]
        .sort((a, b) => b.points - a.points || a.bestRank - b.bestRank || (a.weekRank ?? 11) - (b.weekRank ?? 11))
        .slice(0, 10)
        .map((e, i) => ({ title: e.title, rank: i + 1, weekRank: e.weekRank, weeks: e.weeks }))
    }

    const movies = aggregate('Films')
    const shows = aggregate('TV')
    if (!movies.length && !shows.length) {
      return Response.json({ error: 'Catégories inattendues dans le fichier Netflix' }, { status: 502 })
    }

    return Response.json(
      { week: latest, weeks, movies, shows },
      {
        headers: {
          'Cache-Control': 'public, max-age=21600',
          // Le CDN Netlify garde la réponse 6 h : un seul téléchargement du
          // fichier Netflix pour tout le monde, au lieu d'un par visite.
          'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=21600, stale-while-revalidate=86400',
        },
      },
    )
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 })
  }
}
