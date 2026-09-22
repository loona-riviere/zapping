// Recommandations personnalisées par Gemini (offre gratuite Google AI Studio).
//
// Edge Function plutôt que fonction classique : Gemini met parfois plus de
// 10 s à répondre (bibliothèque entière + une centaine de candidats), le
// délai d'une fonction Netlify classique, qui répondait alors « 502 ». Une
// Edge Function a jusqu'à 40 s ; le temps passé à attendre Gemini ne compte
// pas dans sa limite de calcul. Pas de dépendance : Supabase via son API
// REST, en simple fetch.
//
// Gemini ne propose rien « de mémoire » : il choisit parmi des candidats que
// l'app lui fournit — titres récents dispos en France, Top 10 Netflix,
// titres proches de la bibliothèque — et doit citer leur identifiant. Ça
// évite les titres inventés, et les sorties trop récentes pour qu'il les
// connaisse arrivent avec leur résumé.

type Candidate = {
  id: number
  title: string
  originalTitle?: string
  year: number | null
  genreIds: number[]
  overview?: string | null
  vote?: number
  tag?: string
  /** Données d'affichage (affiche, titre…) renvoyées telles quelles et mises en cache, jamais envoyées à Gemini. */
  item?: unknown
}

type Body = {
  kind: 'show' | 'movie'
  /** « cached » : la dernière sélection si elle est encore valable, sans appeler Gemini. */
  mode: 'cached' | 'generate'
  force?: boolean
  library: string[]
  dismissed: string[]
  candidates: Candidate[]
}

type Pick = { item: unknown; reason: string; tag?: string }

// Une sélection sert 24 h, et n'est refaite qu'à l'ouverture de l'app : un
// jour sans visite ne coûte rien. « Actualiser » est possible au plus toutes
// les 6 h. Au pire 2 appels Gemini par jour d'utilisation (séries + films).
const FRESH_MS = 24 * 60 * 60 * 1000
const MIN_REFRESH_MS = 6 * 60 * 60 * 1000

const GENRES: Record<number, string> = {
  28: 'action', 12: 'aventure', 16: 'animation', 35: 'comédie', 80: 'crime', 99: 'documentaire',
  18: 'drame', 10751: 'familial', 14: 'fantastique', 36: 'histoire', 27: 'horreur', 10402: 'musique',
  9648: 'mystère', 10749: 'romance', 878: 'science-fiction', 10770: 'téléfilm', 53: 'thriller',
  10752: 'guerre', 37: 'western', 10759: 'action & aventure', 10762: 'jeunesse', 10763: 'info',
  10764: 'téléréalité', 10765: 'SF & fantastique', 10766: 'soap', 10767: 'talk-show', 10768: 'guerre & politique',
}

// Modèles Flash de l'offre gratuite, dans l'ordre de préférence. Chacun a sa
// propre charge et son propre quota : si l'un est saturé (503) ou a épuisé
// son quota du jour (429), on passe au suivant plutôt que d'échouer.
const MODELS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest']

export const config = { path: '/api/ai-recommendations' }

const clip = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

function buildPrompt(b: Body) {
  const what = b.kind === 'show' ? 'séries' : 'films'
  const lines = b.candidates.map((c) => {
    const genres = c.genreIds.map((g) => GENRES[g]).filter(Boolean).join(', ')
    const orig = c.originalTitle && c.originalTitle !== c.title ? ` / ${c.originalTitle}` : ''
    const bits = [
      `[${c.id}] ${c.title}${orig} (${c.year ?? '?'})`,
      genres && `genres : ${genres}`,
      c.vote ? `note TMDB ${c.vote.toFixed(1)}` : '',
      c.tag ?? '',
      c.overview ? `— ${clip(c.overview, 220)}` : '',
    ]
    return bits.filter(Boolean).join(' · ')
  })
  return [
    `BIBLIOTHÈQUE (ce qu'elle a regardé, et ce qu'elle en a pensé) :`,
    ...b.library.map((l) => `- ${l}`),
    '',
    b.dismissed.length ? `SUGGESTIONS QU'ELLE A ÉCARTÉES (ne l'intéressent pas) : ${b.dismissed.join(' ; ')}` : '',
    '',
    `CANDIDATS (${what} disponibles en France, choisis uniquement parmi eux, par leur [id]) :`,
    ...lines,
  ].join('\n')
}

const SYSTEM = `Tu es le conseiller séries et films d'une personne en France, qui utilise une appli de suivi.
À partir de sa bibliothèque, choisis parmi les CANDIDATS les 12 titres qu'elle a le plus de chances d'adorer, du plus au moins probable.
Règles :
- uniquement des [id] présents dans la liste des candidats ;
- déduis ses goûts de ses notes, de ce qu'elle revoit, de ce qu'elle abandonne et des suggestions écartées ; évite ce qui y ressemble ;
- privilégie ce qui est moderne, marquant et dans l'air du temps, pas des titres obscurs ;
- varie les genres et les ambiances plutôt que 12 variations du même titre ;
- pour chaque choix, une raison en français, au tutoiement, 100 caractères maximum, qui cite un ou deux titres précis de sa bibliothèque et dit pourquoi ça lui plaira.`

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    picks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: { type: 'INTEGER' }, reason: { type: 'STRING' } },
        required: ['id', 'reason'],
      },
    },
  },
  required: ['picks'],
}

/**
 * Lit la réponse JSON de Gemini. Si elle est coupée (limite de longueur),
 * on garde toutes les recommandations complètes qu'elle contient plutôt que
 * de tout perdre pour la dernière, inachevée.
 */
export function parsePicks(text: string): { id: number; reason: string }[] {
  try {
    const parsed = JSON.parse(text) as { picks?: { id: number; reason: string }[] }
    if (Array.isArray(parsed.picks)) return parsed.picks
  } catch {
    /* réponse tronquée : récupération ci-dessous */
  }
  const out: { id: number; reason: string }[] = []
  const re = /\{\s*"id"\s*:\s*(\d+)\s*,\s*"reason"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g
  for (const m of text.matchAll(re)) {
    try {
      out.push({ id: Number(m[1]), reason: JSON.parse(`"${m[2]}"`) as string })
    } catch {
      /* raison mal échappée : on saute celle-là */
    }
  }
  if (!out.length) throw new Error('réponse Gemini illisible')
  return out
}

async function askGemini(key: string, prompt: string) {
  const failures: number[] = []
  let lastError = ''
  for (const model of MODELS) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: SCHEMA,
          temperature: 0.6,
          // Large : sur les modèles qui « réfléchissent » avant de répondre,
          // cette réflexion est décomptée de la même limite — à 2048, la
          // réponse arrivait coupée au milieu de la liste.
          maxOutputTokens: 8192,
          ...(model.startsWith('gemini-2.5-') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
    })
    // Modèle inconnu, saturé, quota épuisé ou panne passagère : modèle suivant.
    if ([404, 429, 500, 503].includes(res.status)) {
      failures.push(res.status)
      lastError = `${model} : ${res.status}`
      continue
    }
    if (!res.ok) throw new Error(`Gemini a répondu ${res.status} : ${clip(await res.text(), 200)}`)
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] }
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('')
    return { picks: parsePicks(text) }
  }
  if (failures.includes(503) || failures.includes(500)) {
    throw new Error('Gemini est surchargé en ce moment, réessaie dans quelques minutes')
  }
  if (failures.includes(429)) throw new Error('quota Gemini gratuit atteint pour aujourd’hui')
  throw new Error(lastError || 'aucun modèle Gemini disponible')
}

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('POST attendu', { status: 405 })

  const env = (...names: string[]) => names.map((n) => Netlify.env.get(n)).find(Boolean)
  const geminiKey = env('GEMINI_API_KEY')
  // Les variables publiques du site suffisent : on agit avec la session de la
  // personne (RLS), pas avec la clé service_role.
  const supabaseUrl = env('SUPABASE_URL', 'VITE_SUPABASE_URL')
  const anonKey = env('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY')
  const missing = [!geminiKey && 'GEMINI_API_KEY', !supabaseUrl && 'VITE_SUPABASE_URL', !anonKey && 'VITE_SUPABASE_ANON_KEY']
    .filter(Boolean)
    .join(', ')
  if (missing || !geminiKey || !supabaseUrl || !anonKey) {
    return Response.json({ error: `variable(s) absente(s) côté fonctions Netlify : ${missing}` }, { status: 503 })
  }

  // Réservé aux personnes connectées à l'app : sans ça, n'importe qui
  // pourrait consommer le quota Gemini gratuit. Tout passe ensuite avec sa
  // session (RLS) : chacun ne lit et n'écrit que sa propre sélection.
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!jwt) return Response.json({ error: 'non connecté' }, { status: 401 })
  const headers = { apikey: anonKey, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, { headers })
  const user = userRes.ok ? ((await userRes.json()) as { id?: string }) : null
  if (!user?.id) return Response.json({ error: 'session invalide' }, { status: 401 })

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return Response.json({ error: 'requête illisible' }, { status: 400 })
  }
  if (body.kind !== 'show' && body.kind !== 'movie') {
    return Response.json({ error: 'requête incomplète' }, { status: 400 })
  }

  const table = `${supabaseUrl}/rest/v1/ai_recommendations`
  const rowRes = await fetch(`${table}?select=picks,created_at&user_id=eq.${user.id}&kind=eq.${body.kind}`, { headers })
  const row = rowRes.ok ? (((await rowRes.json()) as { picks: Pick[]; created_at: string }[])[0] ?? null) : null
  const age = row ? Date.now() - new Date(row.created_at).getTime() : Infinity
  const cached = row ? { picks: row.picks as Pick[], generatedAt: row.created_at as string, cached: true } : null

  if (body.mode !== 'generate') {
    return Response.json(cached && age < FRESH_MS ? cached : { stale: true, ...(cached ?? {}) })
  }
  if (cached && (age < MIN_REFRESH_MS || (!body.force && age < FRESH_MS))) return Response.json(cached)

  if (!Array.isArray(body.candidates) || !Array.isArray(body.library)) {
    return Response.json({ error: 'requête incomplète' }, { status: 400 })
  }
  // Bornes : garde le prompt dans une taille raisonnable quoi qu'envoie le client.
  body.candidates = body.candidates.slice(0, 120)
  body.library = body.library.slice(0, 400).map((l) => clip(String(l), 160))
  body.dismissed = (body.dismissed ?? []).slice(0, 150).map((d) => clip(String(d), 80))
  if (!body.candidates.length) return Response.json({ picks: [] })

  try {
    const { picks } = await askGemini(geminiKey, buildPrompt(body))
    const byId = new Map(body.candidates.map((c) => [c.id, c]))
    const seen = new Set<number>()
    const clean: Pick[] = (picks ?? [])
      .filter((p) => byId.has(p.id) && !seen.has(p.id) && seen.add(p.id))
      .slice(0, 12)
      .map((p) => {
        const c = byId.get(p.id)!
        return { item: c.item ?? { id: c.id, title: c.title }, reason: clip(p.reason, 140), tag: c.tag }
      })
    const generatedAt = new Date().toISOString()
    if (clean.length) {
      await fetch(table, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ user_id: user.id, kind: body.kind, picks: clean, created_at: generatedAt }),
      })
    }
    return Response.json({ picks: clean, generatedAt, cached: false })
  } catch (e) {
    // Gemini en panne ou quota atteint : l'ancienne sélection vaut mieux que rien.
    if (cached) return Response.json({ ...cached, error: (e as Error).message })
    return Response.json({ error: (e as Error).message }, { status: 502 })
  }
}
