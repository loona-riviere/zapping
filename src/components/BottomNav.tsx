import { isLibrary } from './Library'
import { href, type Route } from '../lib/route'

/**
 * Barre de navigation mobile, en bas d'écran comme les apps natives : plus
 * facile à atteindre au pouce qu'un header textuel tout en haut. Le header
 * garde son rôle sur desktop (souris, écran large) via une règle CSS qui
 * bascule l'un ou l'autre selon la largeur, pas le JS.
 */
export function BottomNav({ route }: { route: Route }) {
  return (
    <nav className="bottomnav" aria-label="Navigation principale">
      <a href={href.home} aria-current={isLibrary(route) ? 'page' : undefined}>
        <LibraryIcon />
        <span>Bibliothèque</span>
      </a>
      <a href={href.search} aria-current={route.name === 'search' ? 'page' : undefined}>
        <SearchIcon />
        <span>Chercher</span>
      </a>
      <a href={href.import} aria-current={route.name === 'import' ? 'page' : undefined}>
        <ImportIcon />
        <span>Import</span>
      </a>
      <a href={href.stats} aria-current={route.name === 'stats' ? 'page' : undefined}>
        <StatsIcon />
        <span>Stats</span>
      </a>
    </nav>
  )
}

const ICON_PROPS = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

function LibraryIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3" y="4" width="7" height="16" rx="1" />
      <rect x="14" y="4" width="7" height="10" rx="1" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.2" y2="16.2" />
    </svg>
  )
}

function ImportIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 3v11" />
      <path d="M7 9l5 5 5-5" />
      <path d="M4 18v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
    </svg>
  )
}

function StatsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="4" y1="21" x2="4" y2="12" />
      <line x1="12" y1="21" x2="12" y2="6" />
      <line x1="20" y1="21" x2="20" y2="15" />
    </svg>
  )
}
