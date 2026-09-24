import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Mire, PosterWall } from './Backdrop'

type Mode = 'password' | 'code'
type Step = 'form' | 'sending' | 'sent' | 'verifying'

export function Auth() {
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<Step>('form')
  const [error, setError] = useState('')

  useEffect(() => {
    // Quand l'échange OAuth échoue côté serveur (ex. state Safari perdu en
    // route), Supabase revient ici avec ?error_description=… dans l'URL —
    // sans ça, l'appli retombe juste sur ce formulaire sans un mot d'explication.
    const params = new URLSearchParams(window.location.search)
    const desc = params.get('error_description')
    if (desc) {
      setError(desc.replace(/\+/g, ' '))
      window.history.replaceState(null, '', window.location.pathname + window.location.hash)
    }
  }, [])

  async function signIn(e: FormEvent) {
    e.preventDefault()
    setStep('sending')
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setStep('form')
    }
    // Succès : onAuthStateChange (dans App.tsx) prend le relais.
  }

  async function signUp() {
    if (!email || !password) {
      setError('Renseigne une adresse et un mot de passe avant de créer le compte.')
      return
    }
    setStep('sending')
    setError('')
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) {
      setError(error.message)
      setStep('form')
      return
    }
    // Selon la config Supabase (« Confirm email »), la session arrive tout de
    // suite ou seulement après avoir cliqué le lien de confirmation reçu.
    if (!data.session) {
      setError('')
      setStep('form')
      alert('Compte créé. Si un e-mail de confirmation est requis, ouvre-le puis reconnecte-toi.')
    }
    setStep('form')
  }

  async function signInWithGoogle() {
    // Sans ce garde-fou, un double-tap relance signInWithOAuth avant la
    // redirection : le second appel écrase le cookie d'état PKCE du premier,
    // et le retour de Google échoue avec « state missing » ou « already used ».
    if (step === 'sending') return
    setStep('sending')
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
    if (error) {
      setError(error.message)
      setStep('form')
    }
    // Succès : la page redirige vers Google, pas besoin de repasser step à 'form'.
  }

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    setStep('sending')
    setError('')
    const { error } = await supabase.auth.signInWithOtp({ email })
    if (error) {
      setError(error.message)
      setStep('form')
    } else {
      setStep('sent')
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    setStep('verifying')
    setError('')
    const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'email' })
    if (error) {
      setError(error.message)
      setStep('sent')
    }
  }

  function switchMode(next: Mode) {
    setMode(next)
    setStep('form')
    setCode('')
    setError('')
  }

  return (
    <div className="auth-screen">
      <PosterWall />
      <div className="auth-screen__veil" aria-hidden="true" />
      <main className="auth auth--card">
        <h1 className="wordmark wordmark--big">Zapping</h1>
        <Mire />
        <p className="auth__lede">Séries, films, livres : retrouve toujours où tu en es.</p>

        {mode === 'password' && (
          <>
            <form onSubmit={signIn} className="auth__form">
              <label htmlFor="email">Adresse e-mail</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <label htmlFor="password">Mot de passe</label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button className="btn btn--primary" disabled={step === 'sending'}>
                {step === 'sending' ? 'Connexion…' : 'Se connecter'}
              </button>
              {error && <p className="error">{error}</p>}
            </form>

            <button className="btn btn--google" onClick={signInWithGoogle} disabled={step === 'sending'}>
              <GoogleG /> Continuer avec Google
            </button>

            <p className="auth__signup muted">
              Pas encore de compte ?{' '}
              <button type="button" className="link-btn" disabled={step === 'sending'} onClick={signUp}>
                Créer un compte
              </button>
            </p>

            <button className="link-btn auth__switch" onClick={() => switchMode('code')}>
              Se connecter avec un code reçu par e-mail à la place
            </button>
          </>
        )}

        {mode === 'code' && (
          <>
            {step !== 'sent' && step !== 'verifying' ? (
              <form onSubmit={sendCode} className="auth__form">
                <label htmlFor="email-code">Adresse e-mail</label>
                <input
                  id="email-code"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button className="btn btn--primary" disabled={step === 'sending'}>
                  {step === 'sending' ? 'Envoi…' : 'Recevoir un code'}
                </button>
                {error && <p className="error">Envoi impossible : {error}</p>}
              </form>
            ) : (
              <form onSubmit={verify} className="auth__form">
                <p className="auth__sent">
                  Un code à 6 chiffres a été envoyé à <strong>{email}</strong>.
                </p>
                <label htmlFor="code">Code reçu par e-mail</label>
                <input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  autoFocus
                  maxLength={6}
                  className="auth__code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
                <button className="btn btn--primary" disabled={step === 'verifying' || code.length < 6}>
                  {step === 'verifying' ? 'Vérification…' : 'Se connecter'}
                </button>
                {error && <p className="error">{error}</p>}
              </form>
            )}
            <button className="link-btn auth__switch" onClick={() => switchMode('password')}>
              Se connecter avec un mot de passe à la place
            </button>
          </>
        )}
      </main>
    </div>
  )
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.68-3.87 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.96H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.04l3-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.96l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z" />
    </svg>
  )
}
