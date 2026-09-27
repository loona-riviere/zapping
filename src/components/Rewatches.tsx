import { useState } from 'react'
import { useApp } from '../lib/appState'
import { formatShortDate, isAired } from '../lib/progress'
import type { Viewing } from '../lib/store'
import type { TvEpisode, TvShow } from '../lib/tvmaze'
import { useSocial } from '../lib/socialState'
import { DateField, History, type HistoryEntry } from './History'
import { useWithLabel, WithPicker } from './WithPicker'

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
  const { tracked, rewatchesOf, setShowViewings, setShowFirstWith, isRewatching, startRewatch, endRewatch, watchedFor, historyFor } = useApp()
  const { duoFor } = useSocial()
  const withLabel = useWithLabel()
  // Série cochée à deux en ce moment : le visionnage en cours est « avec » cet ami.
  const duo = duoFor(show.id)
  const linked = duo ? [duo.partnerId] : []
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Viewing>({ started_at: null, finished_at: null })
  const n = rewatchesOf(show.id)
  const running = isRewatching(show.id)
  const row = tracked.find((t) => t.show_id === show.id)
  const past = row?.past_viewings ?? []
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
      text: (rewatchDates.length ? `Revisionnage en cours, depuis le ${formatShortDate(rewatchDates[0])}` : 'Revisionnage en cours'),
      with: withLabel(linked),
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
      with: withLabel(v.with),
    edit: (
      <span className="hist__dates">
        <DateField label="Du" value={v.started_at} onChange={(x) => save(past.map((p, j) => (j === i ? { ...p, started_at: x } : p)), n)} />
        <DateField label="Au" value={v.finished_at} onChange={(x) => save(past.map((p, j) => (j === i ? { ...p, finished_at: x } : p)), n)} />
        <WithPicker value={v.with} onChange={(ids) => save(past.map((p, j) => (j === i ? { ...p, with: ids } : p)), n)} />
      </span>
    ),
    onRemove: () => confirm('Supprimer ce visionnage ?') && save(past.filter((_, j) => j !== i), n - 1),
  }))
  if (firstDates.length) {
    const end = complete || n || running ? firstDates[firstDates.length - 1] : null
    // Premier visionnage encore en cours et série cochée à deux : il est « avec » cet ami.
    const firstWith = row?.first_with?.length ? row.first_with : !running && !end ? linked : []
    dated.push({
      at: firstDates[firstDates.length - 1],
      key: 'first',
      icon: '✓',
      text: (end ? `Vue ${span(firstDates[0], end)}` : `En cours, ${span(firstDates[0], end)}`),
      with: withLabel(firstWith),
      edit: (
        <span className="hist__dates">
          <span>{(end ? `Vue ${span(firstDates[0], end)}` : `En cours, ${span(firstDates[0], end)}`)}</span>
          <WithPicker value={row?.first_with} onChange={(ids) => setShowFirstWith(show.id, ids)} />
        </span>
      ),
    })
  }
  dated.sort((a, b) => b.at.localeCompare(a.at))
  entries.push(...dated)
  if (undated > 0) {
    entries.push({
      key: 'undated',
      icon: '✓',
      text: undated > 1 ? `Vue ${undated} autres fois, dates inconnues` : 'Vue une autre fois, date inconnue',
      onRemove: () => confirm('Retirer un de ces visionnages sans date ?') && save(past, n - 1),
    })
  }

  const total = n + 1
  const latest = dated[0]
  const summaryLine = running
    ? `Revisionnage en cours · vue ${total} fois`
    : total > 1
      ? `Vue ${total} fois${latest ? ` · ${latest.text.replace(/^Vue /, 'dernière ')}` : ''}`
      : undefined


  return (
    <>
      <History
        title="Visionnages"
        summary={summaryLine}
        footer={
          running &&
          !complete && (
            <button
              type="button"
              className="pill pill--small"
              onClick={() =>
                confirm(`Arrêter le revisionnage de ${show.name} ? La progression de cette passe sera perdue, pas l'historique.`) &&
                endRewatch(show.id, false)
              }
            >
              Arrêter le revisionnage
            </button>
          )
        }
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
      {running && complete && (
        <div className="pills">
          <button className="btn btn--primary" onClick={() => endRewatch(show.id, true, linked)}>
            Terminer le revisionnage
          </button>
        </div>
      )}
    </>
  )
}
