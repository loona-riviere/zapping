// Genres de livres, en français et en nombre limité : assez larges pour que
// les statistiques par genre veuillent dire quelque chose. Les catalogues
// (Google Books, Open Library) donnent des catégories en anglais, parfois
// fines (« Fiction / Thrillers / Suspense »), souvent juste « Fiction » :
// on les ramène à l'un de ces genres quand il y en a un vrai, corrigeable à
// la main sur la fiche.

export const GENRES = [
  'Policier & thriller',
  'SF & fantasy',
  'Romance',
  'Roman historique',
  'Horreur',
  'BD & manga',
  'Jeunesse',
  'Biographie',
  'Histoire',
  'Essai',
  'Développement personnel',
  'Sciences',
  'Poésie',
  'Théâtre',
  'Cuisine',
  'Voyage',
] as const

export type Genre = (typeof GENRES)[number]

// Du plus précis au plus large : « Fiction / Science Fiction » doit donner
// « SF & fantasy », pas « Roman ».
const RULES: [RegExp, Genre | null][] = [
  [/science.?fiction|fantasy|fantastique|dystopi|space opera|sf\b/, 'SF & fantasy'],
  [/thriller|mystery|myst[eè]re|detective|crime|suspense|policier|polar|noir\b/, 'Policier & thriller'],
  [/horror|horreur|epouvante|épouvante/, 'Horreur'],
  [/romance|love stor|sentimental/, 'Romance'],
  [/comics|graphic novel|manga|bande dessin|\bbd\b/, 'BD & manga'],
  [/juvenile|young adult|children|jeunesse|enfant/, 'Jeunesse'],
  [/historical fiction|fiction.{0,20}histor|roman historique/, 'Roman historique'],
  [/biograph|memoir|autobiograph|m[ée]moires/, 'Biographie'],
  [/self-help|self help|d[ée]veloppement personnel|personal growth|psycholog|body, mind|mind & spirit/, 'Développement personnel'],
  [/poetry|po[ée]sie/, 'Poésie'],
  [/drama|th[ée][aâ]tre/, 'Théâtre'],
  [/cooking|cuisine|recette/, 'Cuisine'],
  [/travel|voyage/, 'Voyage'],
  [/histor|histoire/, 'Histoire'],
  // « Social Science », « Political Science » : pas des sciences au sens où on l'entend ici.
  [/social science|political science/, null],
  [/science|nature|mathemat|technolog|medical|m[ée]decine/, 'Sciences'],
]
// Pas de « Roman » ni d'« Essai » : ce sont des formes, pas des genres. Un
// livre que le catalogue ne classe que « Fiction » reste sans genre.

/** Le genre le plus probable d'après les catégories du catalogue ; null si rien n'y ressemble. */
export function guessGenre(categories: string[]): Genre | null {
  const text = categories.join(' / ').toLowerCase()
  if (!text) return null
  for (const [re, genre] of RULES) if (re.test(text)) return genre
  return null
}

/** Un genre enregistré qui n'existe plus dans la liste (ancien « Roman », « Essai »…) compte comme inconnu. */
export const knownGenre = (g: string | null | undefined): Genre | null =>
  g && (GENRES as readonly string[]).includes(g) ? (g as Genre) : null
