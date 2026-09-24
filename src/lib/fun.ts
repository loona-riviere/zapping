// Petits moments de fête et clins d'œil, déclenchés par ce qu'on fait
// vraiment dans l'app : un livre terminé, une série bouclée, un palier
// franchi, un épisode coché à 2 h du matin. Un bus d'évènements minimal :
// l'état (séries, films, livres) signale, <Celebrations /> affiche.

export type Cheer = { text: string; confetti: boolean }

type Listener = (c: Cheer) => void
const listeners = new Set<Listener>()

export function onCheer(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(c: Cheer) {
  listeners.forEach((fn) => fn(c))
}

/** Une vraie fin : confettis et message. */
export function celebrate(text: string) {
  emit({ text, confetti: true })
}

/* ---------------------------------------------------------------- paliers -- */

const STEPS: Record<'episode' | 'movie' | 'book', number[]> = {
  episode: [100, 250, 500, 1000, 2000, 3000, 5000, 7500, 10000],
  movie: [10, 25, 50, 100, 200, 300, 500, 1000],
  book: [10, 25, 50, 75, 100, 150, 200, 300, 500],
}

const MILESTONE_TEXT: Record<keyof typeof STEPS, (n: number) => string> = {
  episode: (n) => `📺 ${n.toLocaleString('fr-FR')}e épisode coché ! Le canapé a gardé ta forme.`,
  movie: (n) => `🎬 ${n.toLocaleString('fr-FR')}e film vu ! Le pop-corn te dit merci.`,
  book: (n) => `📚 ${n.toLocaleString('fr-FR')}e livre lu ! Ta bibliothèque déborde.`,
}

/**
 * Un palier franchi entre `before` et `after` (un seul fêté, le plus haut).
 * Une reprise en masse (import) ne fête rien : on ne franchit pas 500
 * épisodes d'un coup en regardant vraiment.
 */
export function checkMilestone(kind: keyof typeof STEPS, before: number, after: number) {
  if (after <= before || after - before > 3) return
  const crossed = STEPS[kind].filter((s) => before < s && after >= s)
  if (crossed.length) celebrate(MILESTONE_TEXT[kind](crossed[crossed.length - 1]))
}

/* ----------------------------------------------------------- oiseau de nuit -- */

const NIGHT_KEY = 'zapping:night'

const NIGHT_TEXT: Record<'show' | 'movie' | 'book', string[]> = {
  show: ['🌙 Juste un dernier, hein ?', '🦉 Il est tard… le prochain épisode sera encore là demain.', '😴 « Épisode suivant dans 5 s » — ou pas ?'],
  movie: ['🌙 Séance de minuit, rien que ça.', '🦉 Le film est fini, le lit t\'attend.'],
  book: ['📖 Encore un chapitre… et après, dodo ?', '🌙 Lire à la lampe torche, version adulte.', '🦉 Les pages se tournent, les heures aussi.'],
}

/**
 * Entre 1 h et 5 h du matin, une fois par nuit au plus : un clin d'œil à
 * qui coche encore un épisode ou avance sa page.
 */
export function nightOwl(kind: 'show' | 'movie' | 'book', now = new Date()) {
  const h = now.getHours()
  if (h < 1 || h >= 5) return
  const night = now.toISOString().slice(0, 10)
  try {
    if (localStorage.getItem(NIGHT_KEY) === night) return
    localStorage.setItem(NIGHT_KEY, night)
  } catch {
    /* stockage indisponible : tant pis, le message peut revenir */
  }
  const pool = NIGHT_TEXT[kind]
  emit({ text: pool[Math.floor(Math.random() * pool.length)], confetti: false })
}

/* ------------------------------------------------------------ anniversaire -- */

const BIRTHDAY_KEY = 'zapping:birthday'

/** Le jour anniversaire de l'inscription, une fois par an. */
export function checkAnniversary(createdAt: string | undefined, now = new Date()) {
  if (!createdAt) return
  const since = new Date(createdAt)
  const years = now.getFullYear() - since.getFullYear()
  if (years < 1 || now.getMonth() !== since.getMonth() || now.getDate() !== since.getDate()) return
  const key = String(now.getFullYear())
  try {
    if (localStorage.getItem(BIRTHDAY_KEY) === key) return
    localStorage.setItem(BIRTHDAY_KEY, key)
  } catch {
    /* stockage indisponible */
  }
  celebrate(`🎂 ${years} an${years > 1 ? 's' : ''} avec Zapping aujourd'hui ! Merci d'être là.`)
}
