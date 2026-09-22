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
})
