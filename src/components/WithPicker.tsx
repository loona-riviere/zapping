import { nameOf } from '../lib/social'
import { useSocial } from '../lib/socialState'

/** « avec Juju et Maman » à partir d'identifiants ; vide si personne. */
export function useWithLabel() {
  const { profileOf, profile } = useSocial()
  return (ids: string[] | undefined) => {
    const names = (ids ?? [])
      .filter((id) => id !== profile?.user_id)
      .map((id) => profileOf(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map(nameOf)
    if (!names.length) return ''
    return ` · 👫 avec ${names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}` : names[0]}`
  }
}

/**
 * En mode « Modifier » d'un visionnage : cocher les amis présents. Jamais
 * demandé ailleurs — on ne le renseigne que si on en a envie.
 */
export function WithPicker({ value, onChange }: { value: string[] | undefined; onChange: (ids: string[]) => void }) {
  const { friends } = useSocial()
  if (!friends.length) return null
  const set = new Set(value ?? [])
  return (
    <span className="with-picker">
      <span className="muted">avec</span>
      {friends.map((f) => (
        <button
          key={f.user_id}
          type="button"
          className={`pill pill--small${set.has(f.user_id) ? ' pill--on' : ''}`}
          aria-pressed={set.has(f.user_id)}
          onClick={() => {
            const next = new Set(set)
            if (next.has(f.user_id)) next.delete(f.user_id)
            else next.add(f.user_id)
            onChange([...next])
          }}
        >
          {nameOf(f)}
        </button>
      ))}
    </span>
  )
}
