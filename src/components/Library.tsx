import { href, type Route } from '../lib/route'
import { Home } from './Home'
import { Movies } from './Movies'
import { Stats } from './Stats'

/** Les trois vues qui composent la bibliothèque, sous un même onglet principal. */
export type LibraryRoute = Extract<Route, { name: 'home' | 'movies' | 'stats' }>

export const isLibrary = (route: Route): route is LibraryRoute =>
  route.name === 'home' || route.name === 'movies' || route.name === 'stats'

export function Library({ route }: { route: LibraryRoute }) {
  return (
    <>
      <nav className="subtabs" aria-label="Bibliothèque">
        <a href={href.home} aria-current={route.name === 'home' ? 'page' : undefined}>Séries</a>
        <a href={href.movies} aria-current={route.name === 'movies' ? 'page' : undefined}>Films</a>
        <a
          href={href.stats}
          className="subtabs__aside"
          aria-current={route.name === 'stats' ? 'page' : undefined}
        >
          Statistiques
        </a>
      </nav>

      {route.name === 'home' && <Home />}
      {route.name === 'movies' && <Movies />}
      {route.name === 'stats' && <Stats />}
    </>
  )
}
