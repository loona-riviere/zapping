import type { ReactNode } from 'react'

export type HistoryEntry = {
  key: string
  icon: string
  text: string
  /** Ce qui remplace le texte en mode modification (champs de date…). */
  edit?: ReactNode
  onRemove?: () => void
}

/**
 * Les lectures d'un livre ou les visionnages d'un film, une ligne chacun,
 * la plus récente en tête. « Modifier » ouvre les dates à la modification ;
 * rien n'est cliquable par accident le reste du temps.
 */
export function History({
  title,
  entries,
  editing,
  onToggle,
  extra,
  actions,
}: {
  title: string
  /** Boutons à côté de « Modifier » (revu, relire…). */
  actions?: ReactNode
  entries: HistoryEntry[]
  editing: boolean
  onToggle: () => void
  /** Sous la liste, en mode modification : ajouter une entrée passée. */
  extra?: ReactNode
}) {
  if (!entries.length) return null
  return (
    <section className="hist">
      <div className="hist__head">
        <h3>{title}</h3>
        <span className="hist__actions">
          {!editing && actions}
          <button type="button" className="pill pill--small" onClick={onToggle}>
            {editing ? 'OK' : 'Modifier'}
          </button>
        </span>
      </div>
      <ul>
        {entries.map((e) => (
          <li key={e.key} className="hist__row">
            <span className="hist__icon" aria-hidden="true">{e.icon}</span>
            <span className="hist__text">{editing && e.edit ? e.edit : e.text}</span>
            {editing && e.onRemove && (
              <button type="button" className="hist__remove" onClick={e.onRemove}>
                Supprimer
              </button>
            )}
          </li>
        ))}
      </ul>
      {editing && extra}
    </section>
  )
}

/** Un champ date compact, au format des fiches. */
export function DateField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string | null
  onChange: (iso: string | null) => void
}) {
  return (
    <label className="hist__date">
      {label}
      <input
        type="date"
        value={value?.slice(0, 10) ?? ''}
        max={new Date().toISOString().slice(0, 10)}
        onChange={(e) => onChange(e.target.value ? `${e.target.value}T12:00:00.000Z` : null)}
      />
    </label>
  )
}
