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

// Le fichier Netflix distingue, par pays, « Films (English) » / « Films
// (Non-English) » (idem pour TV) : deux classements séparés par langue, avec
// chacun leur propre rang 1 à 10. En les fusionnant naïvement et en triant
// seulement par ce rang, on obtenait deux « numéro 1 » côte à côte — dont un
// film franco/non-anglophone en tête de son propre classement mais pas du
// tout populaire dans l'absolu, ce qui expliquait les vieux films arthouse
// affichés comme s'ils étaient en tête du vrai top France. La colonne
// weekly_hours_viewed donne, elle, un vrai volume de visionnage comparable
// entre les deux langues : en re-classant dessus, les deux sous-classements
// se fondent en un seul classement représentatif.
function parseCount(raw: string | undefined): number {
  return Number((raw ?? '').replace(/,/g, ''))
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

    const bucket = (prefix: string): Row[] => {
      const scored = thisWeek
        .filter((r) => r.category?.startsWith(prefix))
        .map((r) => ({
          title: r.show_title,
          views: parseCount(r.weekly_hours_viewed) || parseCount(r.weekly_views),
          rank: Number(r.weekly_rank),
        }))
        .filter((r) => r.rank > 0 && r.rank <= 10)
      // Volume de visionnage dispo : seul classement fiable une fois English
      // et Non-English mélangés. Sinon (colonne absente), retombe sur le rang
      // brut — moins bon si la langue est bien séparée, mais correct si elle
      // ne l'est pas (une seule catégorie « Films »/« TV » pour ce pays).
      const hasViews = scored.some((r) => r.views > 0)
      const sorted = hasViews
        ? scored.sort((a, b) => b.views - a.views)
        : scored.sort((a, b) => a.rank - b.rank)
      return sorted.slice(0, 10).map((r) => ({ title: r.title, rank: r.rank }))
    }

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
