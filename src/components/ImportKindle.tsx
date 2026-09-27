import { useState } from 'react'
import { manualBook, searchBooks, type Book } from '../lib/books'
import { useBooks } from '../lib/booksState'
import { BOOK_STATUSES, BOOK_STATUS_LABEL, type BookStatus } from '../lib/bookStore'
import { readKindleZip, type KindleBook } from '../lib/kindle'
import { formatShortDate } from '../lib/progress'
import { href } from '../lib/route'
import { Poster } from './Poster'

type Line = {
  k: KindleBook
  match: Book | null
  /** Coché = « c'est moi qui l'ai lu ». Rien n'est coché d'office : un compte
   * Amazon partagé mêle les lectures de plusieurs personnes. */
  include: boolean
  status: BookStatus
  fixing: boolean
}

/** Statut proposé : terminé selon Kindle, lu il y a peu, ou lu longtemps. */
function guessStatus(k: KindleBook, newest: string): BookStatus {
  if (k.completedAt) return 'read'
  const days = k.lastRead ? (Date.parse(newest) - Date.parse(k.lastRead)) / 86_400_000 : Infinity
  if (days <= 45) return 'reading'
  return k.hours >= 2 ? 'read' : 'dropped'
}

function datesText(k: KindleBook): string {
  const start = k.firstRead ? formatShortDate(k.firstRead) : null
  if (k.completedAt) return start ? `lu du ${start} au ${formatShortDate(k.completedAt)}` : `terminé le ${formatShortDate(k.completedAt)}`
  if (k.lastRead) return start && start !== formatShortDate(k.lastRead) ? `ouvert du ${start} au ${formatShortDate(k.lastRead)}` : `ouvert le ${formatShortDate(k.lastRead)}`
  return ''
}

/**
 * Import de l'archive Kindle d'Amazon : on dépose Kindle.zip tel quel, on
 * relit la liste (couverture trouvée, statut, dates), on coche ses livres.
 */
export function ImportKindle() {
  const { books, addBook, booksReady } = useBooks()
  const [lines, setLines] = useState<Line[] | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<number | null>(null)
  const owned = new Set(books.map((b) => b.book_id))

  async function onFile(file: File) {
    setError(null)
    setLines(null)
    setDone(null)
    let found: KindleBook[]
    try {
      found = readKindleZip(new Uint8Array(await file.arrayBuffer()))
    } catch (e) {
      setError((e as Error).message)
      return
    }
    const newest = found.reduce((m, k) => (k.lastRead && k.lastRead > m ? k.lastRead : m), '')
    const out: Line[] = found.map((k) => ({ k, match: null, include: false, status: guessStatus(k, newest), fixing: false }))
    setLines(out)
    // Une recherche à la fois : le catalogue n'aime pas les rafales.
    setProgress({ done: 0, total: out.length })
    for (const [i, line] of out.entries()) {
      try {
        const results = await searchBooks(line.k.query)
        line.match = results[0] ?? null
      } catch {
        line.match = null
      }
      setLines([...out])
      setProgress({ done: i + 1, total: out.length })
    }
    setProgress(null)
  }

  const patch = (i: number, p: Partial<Line>) =>
    setLines((prev) => (prev ? prev.map((l, j) => (j === i ? { ...l, ...p } : l)) : prev))

  async function importAll() {
    if (!lines) return
    setSaving(true)
    const seen = new Set<string>()
    let n = 0
    for (const l of lines) {
      if (!l.include) continue
      const book = l.match ?? manualBook(l.k.query, '', null)
      if (owned.has(book.id) || seen.has(book.id)) continue
      seen.add(book.id)
      const finished = l.status === 'read' ? (l.k.completedAt ?? l.k.lastRead) : null
      await addBook(book, l.status, { started_at: l.k.firstRead, finished_at: finished })
      n++
    }
    setSaving(false)
    setDone(n)
    setLines(null)
  }

  if (!booksReady) return <p className="error">Livres indisponibles : relance supabase/schema.sql.</p>

  if (done !== null) {
    return (
      <div className="import__done">
        <h3>{done} livre{done > 1 ? 's' : ''} importé{done > 1 ? 's' : ''}</h3>
        <a className="btn btn--primary" href={href.books}>Voir mes livres</a>
      </div>
    )
  }

  const chosen = lines?.filter((l) => l.include).length ?? 0

  return (
    <div>
      {!lines && (
        <>
          <p className="muted">
            Sur amazon.fr : <strong>Compte → Gérer vos données → Demander vos données → Kindle</strong>.
            Amazon envoie un lien quelques jours plus tard ; dépose ici le fichier <code>Kindle.zip</code> tel quel.
          </p>
          <label className="import__file">
            <input type="file" accept=".zip,application/zip" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
          {error && <p className="error">{error}</p>}
        </>
      )}

      {lines && (
        <>
          <p className="import__legend muted">
            <strong>Coche les livres que tu as lus toi</strong> : un compte Amazon partagé mêle les lectures de
            chacun, rien n'est coché d'office. Le statut est proposé d'après Kindle, change-le si besoin.
          </p>
          {progress && <p className="muted">Recherche des couvertures… {progress.done} / {progress.total}</p>}
          <ul className="rows">
            {lines.map((l, i) => {
              const b = l.match
              const already = !!b && owned.has(b.id)
              return (
                <li key={i} className="row kindle__row">
                  <input
                    type="checkbox"
                    checked={l.include && !already}
                    disabled={already}
                    onChange={(e) => patch(i, { include: e.target.checked })}
                    aria-label={`Importer ${b?.title ?? l.k.query}`}
                  />
                  <Poster src={b?.cover_url} alt={b?.title ?? l.k.query} />
                  <div className="row__body">
                    <h3>{b?.title ?? l.k.query}</h3>
                    <p className="muted">
                      {b ? b.authors.slice(0, 2).join(', ') || 'Auteur inconnu' : progress ? 'Recherche…' : 'Introuvable au catalogue : ajouté tel quel'}
                    </p>
                    <p className="muted kindle__meta">
                      {datesText(l.k)}
                      {l.k.hours >= 0.1 && ` · ${l.k.hours.toFixed(1).replace('.', ',')} h`}
                      {already && ' · déjà dans tes livres'}
                    </p>
                    {b && b.title.toLowerCase() !== l.k.query.toLowerCase() && (
                      <p className="muted kindle__raw">Kindle : {l.k.raw}</p>
                    )}
                    <div className="kindle__actions">
                      <select
                        className="status-picker"
                        value={l.status}
                        onChange={(e) => patch(i, { status: e.target.value as BookStatus, include: true })}
                        aria-label="Statut"
                      >
                        {BOOK_STATUSES.map((s) => (
                          <option key={s} value={s}>{BOOK_STATUS_LABEL[s]}</option>
                        ))}
                      </select>
                      <button className="link-btn muted" onClick={() => patch(i, { fixing: !l.fixing })}>
                        {l.fixing ? 'Fermer' : 'Pas le bon livre ?'}
                      </button>
                    </div>
                    {l.fixing && (
                      <FixBook
                        initial={l.k.query}
                        onPick={(book) => patch(i, { match: book, fixing: false, include: true })}
                      />
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="import__actions import__actions--sticky">
            <button className="btn btn--primary" disabled={!chosen || saving || !!progress} onClick={importAll}>
              {saving ? 'Import…' : `Importer ${chosen} livre${chosen > 1 ? 's' : ''}`}
            </button>
            <button className="btn btn--ghost" onClick={() => setLines(null)} disabled={saving}>Annuler</button>
          </div>
        </>
      )}
    </div>
  )
}

/** Recherche manuelle quand Kindle et le catalogue ne s'accordent pas sur le titre. */
function FixBook({ initial, onPick }: { initial: string; onPick: (b: Book) => void }) {
  const [q, setQ] = useState(initial)
  const [results, setResults] = useState<Book[] | null>(null)
  return (
    <div className="kindle__fix">
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setResults(null)
          setResults(await searchBooks(q).catch(() => []))
        }}
      >
        <input className="search__input" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Titre du livre" />
        <button className="btn btn--ghost">Chercher</button>
      </form>
      {results && !results.length && <p className="muted">Rien trouvé.</p>}
      <ul className="rows">
        {(results ?? []).slice(0, 5).map((b) => (
          <li key={b.id} className="row">
            <button type="button" className="row__link kindle__pick" onClick={() => onPick(b)}>
              <Poster src={b.cover_url} alt={b.title} />
              <span className="row__body">
                <strong>{b.title}</strong>
                <span className="muted"> {b.authors.slice(0, 2).join(', ')}{b.year ? ` · ${b.year}` : ''}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
