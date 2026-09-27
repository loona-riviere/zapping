import { useState } from 'react'
import { useApp } from '../lib/appState'
import { formatShortDate, isAired } from '../lib/progress'
import type { Viewing } from '../lib/store'
import type { TvEpisode, TvShow } from '../lib/tvmaze'
import { DateField, History, type HistoryEntry } from './History'

const span = (start: string | null, end: string | null) => {
  const d = (x: string) => formatShortDate(x)
  if (start && end) return start.slice(0, 10) === end.slice(0, 10) ? `le ${d(end)}` : `du ${d(start)} au ${d(end)}`
  if (end) return `fini le ${d(end)}`
  if (start) return `commencé le ${d(start)}`
  return 'date inconnue'
}

/**
 * Les visionnages d'une série, comme les lectures d'un livre : le premier
 * (ses épisodes cochés), puis chaque revisionnage terminé avec ses dates, et
 * celui en cours. `rewatches` compte les revisionnages terminés, datés ou non.
 */
export function Rewatches({ show, episodes }: { show: TvShow; episodes: TvEpisode[] }) {
  const { tracked, rewatchesOf, setShowViewings, isRewatching, startRewatch, endRewatch, watchedFor, historyFor } = useApp()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Viewing>({ started_at: null, finished_at: null })
  const n = rewatchesOf(show.id)
  const running = isRewatching(show.id)
  const past = tracked.find((t) => t.show_id === show.id)?.past_viewings ?? []
  const undated = Math.max(0, n - past.length)

  const seen = watchedFor(show.id)
  const aired = episodes.filter((e) => isAired(e))
  const complete = aired.length > 0 && aired.every((e) => seen.has(e.id))

  const firstDates = [...historyFor(show.id).values()].filter((d): d is string => !!d).sort()
  const rewatchDates = running ? [...seen.values()].filter((d): d is string => !!d).sort() : []

  const save = (next: Viewing[], count: number) => {
    const sorted = [...next].sort((a, b) => (a.finished_at ?? '').localeCompare(b.finished_at ?? ''))
    return setShowViewings(show.id, sorted, Math.max(count, sorted.length))
  }

  const entries: HistoryEntry[] = []
  if (running) {
    entries.push({
      key: 'running',
      icon: '🔁',
      text: rewatchDates.length ? `Revisionnage en cours, depuis le ${formatShortDate(rewatchDates[0])}` : 'Revisionnage en cours',
    })
  }
  // Tous les visionnages terminés, du plus récent au plus ancien : celui des
  // épisodes cochés n'est pas forcément le premier (un visionnage d'avant
  // l'app peut être ajouté après coup avec ses dates).
  const dated: (HistoryEntry & { at: string })[] = past.map((v, i) => ({
    at: v.finished_at ?? v.started_at ?? '',
    key: `past-${i}`,
    icon: '✓',
    text: `Vue ${span(v.started_at, v.finished_at)}`,
    edit: (
      <span className="hist__dates">
        <DateField label="Du" value={v.started_at} onChange={(x) => save(past.map((p, j) => (j === i ? { ...p, started_at: x } : p)), n)} />
        <DateField label="Au" value={v.finished_at} onChange={(x) => save(past.map((p, j) => (j === i ? { ...p, finished_at: x } : p)), n)} />
      </span>
    ),
    onRemove: () => confirm('Supprimer ce visionnage ?') && save(past.filter((_, j) => j !== i), n - 1),
  }))
  if (firstDates.length) {
    const end = complete || n || running ? firstDates[firstDates.length - 1] : null
    dated.push({ at: firstDates[firstDates.length - 1], key: 'first', icon: '✓', text: `Vue ${span(firstDates[0], end)}` })
  }
  dated.sort((a, b) => b.at.localeCompare(a.at))
  entries.push(...dated)
  for (let k = 0; k < undated; k++) {
    entries.push({
      key: `undated-${k}`,
      icon: '✓',
      text: 'Vue, date inconnue',
      onRemove: () => confirm('Supprimer ce visionnage ?') && save(past, n - 1),
    })
  }

  return (
    <>
      <History
        title="Visionnages"
        actions={
          !running &&
          seen.size > 0 && (
            <button type="button" className="pill pill--small" onClick={() => startRewatch(show.id)}>
              🔁 Je la revois
            </button>
          )
        }
        entries={entries}
        editing={editing}
        onToggle={() => setEditing((v) => !v)}
        extra={
          <div className="hist__add">
            <span className="hist__dates">
              <DateField label="Vue du" value={draft.started_at} onChange={(x) => setDraft((d) => ({ ...d, started_at: x }))} />
              <DateField label="au" value={draft.finished_at} onChange={(x) => setDraft((d) => ({ ...d, finished_at: x }))} />
            </span>
            <button
              type="button"
              className="pill pill--small"
              disabled={!draft.started_at && !draft.finished_at}
              onClick={() => {
                // Un revisionnage « date inconnue » qui existait prend ces dates plutôt que d'en créer un de plus.
                save([...past, draft], undated > 0 ? n : n + 1)
                setDraft({ started_at: null, finished_at: null })
              }}
            >
              Ajouter
            </button>
          </div>
        }
      />
      {running ? (
        <div className="pills">
          {complete ? (
            <button className="btn btn--primary" onClick={() => endRewatch(show.id, true)}>
              Terminer le revisionnage
            </button>
          ) : (
            <button
              className="pill"
              onClick={() =>
                confirm(`Arrêter le revisionnage de ${show.name} ? La progression de cette passe sera perdue, pas l'historique.`) &&
                endRewatch(show.id, false)
              }
            >
              Arrêter le revisionnage
            </button>
          )}
        </div>
      ) : null}
    </>
  )
}
