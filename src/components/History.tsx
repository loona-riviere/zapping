import { useState, type ReactNode } from 'react'

export type HistoryEntry = {
  key: string
  icon: string
  text: string
  /** Ce qui remplace le texte en mode modification (champs de date…). */
  edit?: ReactNode
  onRemove?: () => void
}

/**
 * Les lectures d'un livre ou les visionnages d'une série / d'un film, en
 * accordéon : replié, une seule ligne résume (« Vue 6 fois · en cours ») ;
 * déplié, une ligne par visionnage, la plus récente en tête, avec
 * « Modifier » pour les dates. Une seule entrée : elle sert de résumé.
 */
export function History({
  title,
  summary,
  entries,
  editing,
  onToggle,
  extra,
  actions,
  footer,
}: {
  title: string
  /** La ligne affichée repliée ; par défaut, la plus récente. */
  summary?: string
  /** Boutons de l'accordéon déplié, à côté de « Modifier » (revu, relire…). */
  actions?: ReactNode
  entries: HistoryEntry[]
  editing: boolean
  onToggle: () => void
  /** Sous la liste, en mode modification : ajouter une entrée passée. */
  extra?: ReactNode
  /** Sous la liste, déplié hors modification (arrêter un revisionnage…). */
  footer?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  if (!entries.length) return null
  const expanded = open || editing
  const line = summary ?? entries[0].text
  return (
    <section className={`hist${expanded ? ' hist--open' : ''}`}>
      <button
        type="button"
        className="hist__summary"
        aria-expanded={expanded}
        onClick={() => {
          if (editing) onToggle()
          setOpen((v) => !v)
        }}
      >
        <span className="hist__icon" aria-hidden="true">{entries[0].icon}</span>
        <span className="hist__text">
          <span className="hist__title">{title}</span>
          {line}
        </span>
        <span className="hist__chevron" aria-hidden="true">›</span>
      </button>
      {expanded && (
        <>
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
          <div className="hist__foot">
            {!editing && actions}
            {!editing && footer}
            <button type="button" className="pill pill--small" onClick={onToggle}>
              {editing ? 'OK' : 'Modifier les dates'}
            </button>
          </div>
        </>
      )}
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
