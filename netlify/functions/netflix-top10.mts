// Le vrai classement hebdomadaire Netflix, publié tel quel par Netflix (pas
// d'API officielle, mais un fichier public, mis à jour chaque semaine) :
// https://www.netflix.com/tudum/top10
//
// Récupéré ici plutôt que côté navigateur : ce fichier n'a probablement pas
// d'en-têtes CORS pour un site tiers, une fonction serveur contourne ça.
const DATA_URL = 'https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv'

type Row = { title: string; rank: number }

function parseTsv(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n')
  const header = lines[0].split('\t').map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const cells = line.split('\t')
    const row: Record<string, string> = {}
    header.forEach((h, i) => { row[h] = (cells[i] ?? '').trim() })
    return row
  })
}

export default async () => {
  try {
    const res = await fetch(DATA_URL)
    if (!res.ok) {
      return Response.json({ error: `Netflix a répondu ${res.status}` }, { status: 502 })
    }
    const rows = parseTsv(await res.text())

    const fr = rows.filter((r) => r.country_iso2 === 'FR')
    if (!fr.length) {
      return Response.json({ error: 'Aucune ligne France trouvée — format du fichier probablement changé' }, { status: 502 })
    }
    const week = fr.reduce((max, r) => (r.week > max ? r.week : max), fr[0].week)
    const thisWeek = fr.filter((r) => r.week === week)

    const bucket = (prefix: string): Row[] =>
      thisWeek
        .filter((r) => r.category?.startsWith(prefix))
        .map((r) => ({ title: r.show_title, rank: Number(r.weekly_rank) }))
        .filter((r) => r.rank > 0 && r.rank <= 10)
        .sort((a, b) => a.rank - b.rank)

    const movies = [...bucket('Films')]
    const shows = [...bucket('TV')]

    if (!movies.length && !shows.length) {
      return Response.json({ error: 'Colonnes inattendues dans le fichier Netflix' }, { status: 502 })
    }

    return Response.json(
      { week, movies, shows },
      { headers: { 'Cache-Control': 'public, max-age=21600' } }, // 6h : le fichier ne change qu'une fois par semaine
    )
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 })
  }
}
