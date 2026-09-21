import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Auth } from './components/Auth'
import { Home } from './components/Home'
import { Import } from './components/Import'
import { Search } from './components/Search'
import { ShowPage } from './components/ShowPage'
import { AppProvider, useApp } from './lib/appState'
import { href, useRoute } from './lib/route'
import { supabase, supabaseConfigured } from './lib/supabase'

export default function App() {
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
  if (session === undefined) return null
  if (!session) return <Auth />

  return (
    <AppProvider userId={session.user.id}>
      <Shell />
    </AppProvider>
  )
}

function Shell() {
  const route = useRoute()
  const { notice, dismissNotice } = useApp()

  return (
    <>
      <header className="topbar">
        <a href={href.home} className="wordmark">Zapping</a>
        <nav className="topbar__nav">
          <a href={href.home} aria-current={route.name === 'home' ? 'page' : undefined}>Mes séries</a>
          <a href={href.search} aria-current={route.name === 'search' ? 'page' : undefined}>Chercher</a>
          <a href={href.import} aria-current={route.name === 'import' ? 'page' : undefined}>Reprise</a>
          <button className="link-btn" onClick={() => supabase.auth.signOut()}>Déconnexion</button>
        </nav>
      </header>

      <main className="main">
        {route.name === 'home' && <Home />}
        {route.name === 'search' && <Search />}
        {route.name === 'import' && <Import />}
        {route.name === 'show' && <ShowPage id={route.id} />}
      </main>

      {notice && (
        <div className="notice" role="alert">
          <p>{notice}</p>
          <button className="link-btn" onClick={dismissNotice}>Fermer</button>
        </div>
      )}

      <footer className="footer muted">Données séries : TVmaze.com (CC BY-SA)</footer>
    </>
  )
}
