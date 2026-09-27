import type { ReactNode } from 'react'
import { DismissedProvider } from './dismissedState'
import { MoviesProvider } from './moviesState'
import { ShowsProvider } from './showsState'

export type { WatchedEpisodes } from './showsState'

/**
 * États de la bibliothèque, un contexte par domaine : cocher un épisode ne
 * redessine pas les écrans qui ne lisent que les films, et inversement.
 * Chaque écran prend ce dont il a besoin : `useShows`, `useMovies`,
 * `useDismissed` (et `useShowNotice` pour les messages d'erreur).
 */
export function AppProvider({ userId, children }: { userId: string; children: ReactNode }) {
  return (
    <ShowsProvider userId={userId}>
      <MoviesProvider userId={userId}>
        <DismissedProvider userId={userId}>{children}</DismissedProvider>
      </MoviesProvider>
    </ShowsProvider>
  )
}
