import { createContext, useContext, useState, type ReactNode } from 'react'

/**
 * Message d'erreur en bas d'écran, partagé par tous les états (séries, films,
 * livres, amis). Deux contextes : l'un porte le message (lu par la seule
 * barre d'affichage), l'autre la fonction pour en afficher un, qui ne change
 * jamais — afficher un message ne fait donc pas redessiner toute l'app.
 */
type ShowNotice = (message: string | null) => void

const MessageCtx = createContext<string | null>(null)
const SetterCtx = createContext<ShowNotice | null>(null)

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<string | null>(null)
  return (
    <SetterCtx.Provider value={setNotice}>
      <MessageCtx.Provider value={notice}>{children}</MessageCtx.Provider>
    </SetterCtx.Provider>
  )
}

/** Le message affiché, ou null. */
export function useNoticeMessage(): string | null {
  return useContext(MessageCtx)
}

/** Affiche un message (null le ferme). Fonction stable. */
export function useShowNotice(): ShowNotice {
  const set = useContext(SetterCtx)
  if (!set) throw new Error('useShowNotice doit être utilisé dans <NoticeProvider>')
  return set
}

/** Texte d'erreur « Préfixe : message » pour une exception quelconque. */
export const failure = (prefix: string, e: unknown) => `${prefix} : ${(e as Error).message}`
