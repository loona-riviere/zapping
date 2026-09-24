import { KIND_LABEL, usePrefs, type Kind } from '../lib/prefs'
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

const ROUTE_OF: Record<Kind, LibraryRoute['name']> = { show: 'home', movie: 'movies', book: 'books' }
const KIND_OF: Record<LibraryRoute['name'], Kind> = { home: 'show', movies: 'movie', books: 'book' }
const HREF_OF: Record<Kind, string> = { show: href.home, movie: href.movies, book: href.books }

export function Library({ route }: { route: LibraryRoute }) {
  const { kinds, has } = usePrefs()
  // Un type décoché dans les paramètres : l'accueil ouvre le premier suivi.
  const kind = has(KIND_OF[route.name]) ? KIND_OF[route.name] : kinds[0]
  const current = ROUTE_OF[kind]

  return (
    <>
      {kinds.length > 1 && (
        <nav className="subtabs" aria-label="Bibliothèque">
          {kinds.map((k) => (
            <a key={k} href={HREF_OF[k]} aria-current={k === kind ? 'page' : undefined}>{KIND_LABEL[k]}</a>
          ))}
        </nav>
      )}

      {current === 'home' && <Home />}
      {current === 'movies' && <Movies />}
      {current === 'books' && <Books />}
    </>
  )
}
