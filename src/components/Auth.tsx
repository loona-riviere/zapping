import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Step = 'email' | 'sending' | 'code' | 'verifying'

/**
 * Connexion par code à 6 chiffres plutôt que par lien.
 *
 * Ajoutée à l'écran d'accueil, l'app tourne en fenêtre autonome (standalone) :
 * le lien magique, lui, s'ouvre dans Safari, un contexte de stockage séparé,
 * donc le vérificateur PKCE posé au moment de l'envoi n'est plus là pour
 * conclure l'échange une fois de retour dans l'app. Le code se saisit sans
 * jamais quitter l'app, donc ce problème ne se pose pas — c'est pour ça qu'il
 * est proposé en premier, pas seulement en repli.
 */
export function Auth() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<Step>('email')
  const [error, setError] = useState('')

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    setStep('sending')
    setError('')
    const { error } = await supabase.auth.signInWithOtp({ email })
    if (error) {
      setError(error.message)
      setStep('email')
    } else {
      setStep('code')
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    setStep('verifying')
    setError('')
    const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'email' })
    if (error) {
      setError(error.message)
      setStep('code')
    }
    // Succès : onAuthStateChange (dans App.tsx) prend le relais.
  }

  return (
    <main className="auth">
      <h1 className="wordmark wordmark--big">Zapping</h1>
      <p className="auth__lede">Coche les épisodes que tu regardes et retrouve toujours où tu en es.</p>

      {step === 'email' || step === 'sending' ? (
        <form onSubmit={sendCode} className="auth__form">
          <label htmlFor="email">Adresse e-mail</label>
          <input
            id="email"
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
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setStep('email')
              setCode('')
              setError('')
            }}
          >
            Utiliser une autre adresse
          </button>
        </form>
      )}
    </main>
  )
}
