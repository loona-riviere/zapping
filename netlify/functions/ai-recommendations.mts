import { createClient } from '@supabase/supabase-js'

// Recommandations personnalisées par Gemini (offre gratuite Google AI Studio).
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

// Modèle Flash de l'offre gratuite ; l'alias « latest » en secours si le nom
// exact disparaît un jour.
const MODELS = ['gemini-2.5-flash', 'gemini-flash-latest']

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

async function askGemini(key: string, prompt: string) {
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
          maxOutputTokens: 2048,
          // Pas de phase de réflexion : la réponse doit tenir dans le délai
          // d'une fonction Netlify, et le classement n'en a pas besoin.
          ...(model === 'gemini-2.5-flash' ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
    })
    if (res.status === 404) {
      lastError = `modèle ${model} introuvable`
      continue
    }
    if (res.status === 429) throw new Error('quota Gemini atteint pour aujourd’hui')
    if (!res.ok) throw new Error(`Gemini a répondu ${res.status} : ${clip(await res.text(), 200)}`)
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] }
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('')
    return JSON.parse(text) as { picks: { id: number; reason: string }[] }
  }
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
  // pourrait consommer le quota Gemini gratuit.
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!jwt) return Response.json({ error: 'non connecté' }, { status: 401 })
  const db = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: auth, error: authError } = await db.auth.getUser(jwt)
  if (authError || !auth.user) return Response.json({ error: 'session invalide' }, { status: 401 })

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return Response.json({ error: 'requête illisible' }, { status: 400 })
  }
  if (body.kind !== 'show' && body.kind !== 'movie') {
    return Response.json({ error: 'requête incomplète' }, { status: 400 })
  }

  const { data: row } = await db
    .from('ai_recommendations')
    .select('picks, created_at')
    .eq('user_id', auth.user.id)
    .eq('kind', body.kind)
    .maybeSingle()
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
      await db
        .from('ai_recommendations')
        .upsert({ user_id: auth.user.id, kind: body.kind, picks: clean, created_at: generatedAt })
    }
    return Response.json({ picks: clean, generatedAt, cached: false })
  } catch (e) {
    // Gemini en panne ou quota atteint : l'ancienne sélection vaut mieux que rien.
    if (cached) return Response.json({ ...cached, error: (e as Error).message })
    return Response.json({ error: (e as Error).message }, { status: 502 })
  }
}
