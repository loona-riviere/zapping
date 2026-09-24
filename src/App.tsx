import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Auth } from './components/Auth'
import { LaunchScreen, Splash } from './components/Backdrop'
import { BottomNav } from './components/BottomNav'
import { EasterEggOverlay, useLogoEasterEgg } from './components/EasterEgg'
import { Footer } from './components/Footer'
import { Import } from './components/Import'
import { Library, isLibrary } from './components/Library'
import { BookPage } from './components/BookPage'
import { MoviePage } from './components/MoviePage'
import { Search } from './components/Search'
import { Settings } from './components/Settings'
import { ShowPage } from './components/ShowPage'
import { Stats } from './components/Stats'
import { AppProvider, useApp } from './lib/appState'
import { BooksProvider, useBooks } from './lib/booksState'
import { PrefsProvider, usePrefs } from './lib/prefs'
import { href, useRoute } from './lib/route'
import { favoritePosters, saveWallPosters } from './lib/wall'
import { supabase, supabaseConfigured } from './lib/supabase'
import { tmdbConfigured } from './lib/tmdb'

export default function App() {
  return (
    <>
      <AppContent />
      <LaunchScreen />
    </>
  )
}

function AppContent() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      // Nettoie le ?code=… laissé par le lien magique.
      if (window.location.search.includes('code=')) {
        window.history.replaceState(null, '', window.location.pathname + window.location.hash)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  if (!supabaseConfigured) {
    return (
      <main className="auth">
        <h1 className="wordmark wordmark--big">Zapping</h1>
        <p className="error">
          Supabase n'est pas configuré. Renseigne VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY
          dans .env (en local) ou dans les secrets du dépôt GitHub.
        </p>
      </main>
    )
  }
  if (session === undefined) return <Splash />
  if (!session) return <Auth />

  return (
    <PrefsProvider user={session.user}>
      <AppProvider userId={session.user.id}>
        <WithBooks userId={session.user.id} />
      </AppProvider>
    </PrefsProvider>
  )
}

function WithBooks({ userId }: { userId: string }) {
  const { showNotice } = useApp()
  return (
    <BooksProvider userId={userId} onError={showNotice}>
      <Shell />
    </BooksProvider>
  )
}

function Shell() {
  const route = useRoute()
  const { notice, dismissNotice, tracked, movies, loading } = useApp()
  const { books, booksLoading } = useBooks()
  const { has } = usePrefs()
  const { onTap, message } = useLogoEasterEgg()

  // Garde les affiches préférées pour le mur du prochain lancement.
  useEffect(() => {
    if (!loading && !booksLoading) saveWallPosters(
        favoritePosters(has('show') ? tracked : [], has('movie') ? movies : [], has('book') ? books : []),
      )
  }, [loading, booksLoading, tracked, movies, books, has])

  return (
    <>
      <header className="topbar">
        <a href={href.home} className="wordmark" onClick={onTap}>Zapping</a>
        <nav className="topbar__nav">
          <a href={href.home} aria-current={isLibrary(route) ? 'page' : undefined}>Bibliothèque</a>
          <a href={href.search} aria-current={route.name === 'search' ? 'page' : undefined}>Chercher</a>
          <a href={href.stats} aria-current={route.name === 'stats' ? 'page' : undefined}>Statistiques</a>
          <a href={href.settings} aria-current={route.name === 'settings' ? 'page' : undefined}>Paramètres</a>
        </nav>
      </header>

      <main className="main">
        {isLibrary(route) && <Library route={route} />}
        {route.name === 'search' && <Search initialQuery={route.q} initialKind={route.kind} />}
        {route.name === 'import' && <Import />}
        {route.name === 'stats' && <Stats />}
        {route.name === 'settings' && <Settings />}
        {route.name === 'show' && <ShowPage id={route.id} />}
        {route.name === 'movie' && <MoviePage id={route.id} />}
        {route.name === 'book' && <BookPage id={route.id} />}
      </main>

      {notice && (
        <div className="notice" role="alert">
          <p>{notice}</p>
          <button className="link-btn" onClick={dismissNotice}>Fermer</button>
        </div>
      )}

      <Footer tmdbConfigured={tmdbConfigured} />
      <BottomNav route={route} />
      <EasterEggOverlay message={message} />
    </>
  )
}
