import { createClient } from '@supabase/supabase-js'
import { authStorage, ensureStorageHeadroom } from './storage'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(url && key)

// Avant de créer le client : il lit la session tout de suite, et la réécrit
// au premier rafraîchissement — il faut que la place soit là.
ensureStorageHeadroom()

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: {
    // PKCE : le lien magique revient avec ?code=… plutôt qu'un #hash,
    // ce qui ne se mélange pas avec le routage par hash de l'app.
    flowType: 'pkce',
    persistSession: true,
    detectSessionInUrl: true,
    // La session passe avant les caches si le stockage est plein (lib/storage.ts).
    storage: authStorage,
  },
  // Les séries sont identifiées par TMDB depuis la migration : la base refuse
  // les écritures de séries sans cet en-tête (ancienne version restée ouverte).
  global: { headers: { 'x-zapping-series': 'tmdb' } },
})

/**
 * Identifiant de la personne connectée, lu dans la session locale (pas de
 * requête). Les lectures de sa propre bibliothèque filtrent dessus : depuis
 * les amis, la base laisse aussi voir les séries, films et livres des amis,
 * qu'il ne faut pas mélanger aux siens.
 */
export async function me(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('Session expirée : reconnecte-toi.')
  return id
}
