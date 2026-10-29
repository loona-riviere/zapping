import { supabase } from './supabase'

/** Un compte vu depuis l'administration (fonction admin_users du schéma). */
export type AdminUser = {
  user_id: string
  email: string | null
  username: string | null
  display_name: string | null
  created_at: string
  last_sign_in_at: string | null
  last_watched_at: string | null
  shows: number
  episodes: number
  movies: number
  books: number
  friends: number
  push: boolean
}

/**
 * Vrai si le compte connecté figure dans la table admins. Ne sert qu'à
 * afficher le lien : la base refuse de toute façon admin_users() aux autres.
 */
export async function isAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin')
  return !error && data === true
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const { data, error } = await supabase.rpc('admin_users')
  if (error) throw new Error(error.message)
  return (data ?? []) as AdminUser[]
}
