import { href, type Route } from '../lib/route'
import { Books } from './Books'
import { Home } from './Home'
import { Movies } from './Movies'

/**
 * Séries, films et livres, sous un même onglet principal. Les statistiques ont leur
 * propre onglet en haut : les dupliquer ici ferait un onglet dans l'onglet.
 */
export type LibraryRoute = Extract<Route, { name: 'home' | 'movies' | 'books' }>

export const isLibrary = (route: Route): route is LibraryRoute =>
  route.name === 'home' || route.name === 'movies' || route.name === 'books'

export function Library({ route }: { route: LibraryRoute }) {
  return (
    <>
      <nav className="subtabs" aria-label="Bibliothèque">
        <a href={href.home} aria-current={route.name === 'home' ? 'page' : undefined}>Séries</a>
        <a href={href.movies} aria-current={route.name === 'movies' ? 'page' : undefined}>Films</a>
        <a href={href.books} aria-current={route.name === 'books' ? 'page' : undefined}>Livres</a>
      </nav>

      {route.name === 'home' && <Home />}
      {route.name === 'movies' && <Movies />}
      {route.name === 'books' && <Books />}
    </>
  )
}
