// Le classement officiel Netflix en France pour la dernière semaine publiée,
// tel quel, à partir du fichier public que Netflix met à jour chaque mardi
// (https://www.netflix.com/tudum/top10). Récupéré côté serveur : pas
// d'en-têtes CORS pour un site tiers.
//
// La dernière semaine plutôt qu'un cumul sur le mois : c'est l'unité que
// Netflix publie, donc un classement qu'on peut vérifier sur Tudum — un
// cumul maison ne ressemblait à rien de ce que Netflix affiche.
const DATA_URL = 'https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv'

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
    const iWeeks = col('cumulative_weeks_in_top10')
    if ([iCountry, iWeek, iCategory, iRank, iTitle].some((i) => i < 0)) {
      return Response.json({ error: `Colonnes inattendues : ${header.join(', ')}` }, { status: 502 })
    }

    // Le fichier fait des dizaines de Mo : on ne découpe en colonnes que les
    // lignes françaises, repérées d'abord par un simple test de sous-chaîne.
    const rows: { week: string; category: string; rank: number; title: string; weeks: number }[] = []
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
        weeks: iWeeks >= 0 ? Number(cells[iWeeks]) || 1 : 1,
      })
    }
    if (!rows.length) {
      return Response.json({ error: 'Aucune ligne France trouvée' }, { status: 502 })
    }

    // Dates ISO (AAAA-MM-JJ) : l'ordre alphabétique est l'ordre chronologique.
    const week = rows.reduce((max, r) => (r.week > max ? r.week : max), rows[0].week)
    const pick = (prefix: string) =>
      rows
        .filter((r) => r.week === week && r.category.startsWith(prefix) && r.rank >= 1 && r.rank <= 10)
        .sort((a, b) => a.rank - b.rank)
        .map((r) => ({ title: r.title, rank: r.rank, weeks: r.weeks }))

    const movies = pick('Films')
    const shows = pick('TV')
    if (!movies.length && !shows.length) {
      return Response.json({ error: 'Catégories inattendues dans le fichier Netflix' }, { status: 502 })
    }

    return Response.json(
      { week, movies, shows },
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
