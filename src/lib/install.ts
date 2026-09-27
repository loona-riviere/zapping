// Installer l'appli depuis le site. Chrome / Edge / Android envoient
// `beforeinstallprompt` : on le garde pour un vrai bouton « Installer ».
// Safari (iPhone) ne permet pas de le faire à la place de l'utilisateur :
// on explique les deux gestes à faire.

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: PromptEvent | null = null
const listeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as PromptEvent
    listeners.forEach((l) => l())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    listeners.forEach((l) => l())
  })
}

export const canPromptInstall = () => deferred !== null

export function onInstallChange(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Ouvre la fenêtre d'installation du navigateur ; vrai si acceptée. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  const e = deferred
  deferred = null
  await e.prompt()
  const { outcome } = await e.userChoice
  listeners.forEach((l) => l())
  return outcome === 'accepted'
}

export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
