import { useApp } from '../lib/appState'
import { STATUSES, STATUS_LABEL, type ShowStatus } from '../lib/store'

/** Sélecteur de statut : en cours, en pause, à regarder plus tard, abandonnée. */
export function StatusPicker({ showId, id }: { showId: number; id?: string }) {
  const { statusOf, setStatus } = useApp()
  const current = statusOf(showId)
  return (
    <select
      id={id}
      className="status-picker"
      value={current}
      data-status={current}
      onChange={(e) => setStatus(showId, e.target.value as ShowStatus)}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>{STATUS_LABEL[s]}</option>
      ))}
    </select>
  )
}
