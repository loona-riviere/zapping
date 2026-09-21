import { href, type Route } from '../lib/route'
import { Home } from './Home'
import { Movies } from './Movies'

/**
 * Séries et films, sous un même onglet principal. Les statistiques ont leur
 * propre onglet en haut : les dupliquer ici ferait un onglet dans l'onglet.
 */
export type LibraryRoute = Extract<Route, { name: 'home' | 'movies' }>

export const isLibrary = (route: Route): route is LibraryRoute =>
  route.name === 'home' || route.name === 'movies'

export function Library({ route }: { route: LibraryRoute }) {
  return (
    <>
      <nav className="subtabs" aria-label="Bibliothèque">
        <a href={href.home} aria-current={route.name === 'home' ? 'page' : undefined}>Séries</a>
        <a href={href.movies} aria-current={route.name === 'movies' ? 'page' : undefined}>Films</a>
      </nav>

      {route.name === 'home' && <Home />}
      {route.name === 'movies' && <Movies />}
    </>
  )
}
