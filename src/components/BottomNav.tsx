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
      <a href={href.stats} aria-current={route.name === 'stats' ? 'page' : undefined}>
        <StatsIcon />
        <span>Stats</span>
      </a>
      <a href={href.settings} aria-current={route.name === 'settings' ? 'page' : undefined}>
        <SettingsIcon />
        <span>Paramètres</span>
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

function StatsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="4" y1="21" x2="4" y2="12" />
      <line x1="12" y1="21" x2="12" y2="6" />
      <line x1="20" y1="21" x2="20" y2="15" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  )
}
