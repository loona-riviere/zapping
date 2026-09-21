import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(url && key)

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: {
    // PKCE : le lien magique revient avec ?code=… plutôt qu'un #hash,
    // ce qui ne se mélange pas avec le routage par hash de l'app.
    flowType: 'pkce',
    persistSession: true,
    detectSessionInUrl: true,
  },
})
