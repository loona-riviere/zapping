import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export function Auth() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setState('sending')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
    if (error) {
      setError(error.message)
      setState('error')
    } else {
      setState('sent')
    }
  }

  return (
    <main className="auth">
      <h1 className="wordmark wordmark--big">Zapping</h1>
      <p className="auth__lede">Coche les épisodes que tu regardes et retrouve toujours où tu en es.</p>
      {state === 'sent' ? (
        <p className="auth__sent">
          Un lien de connexion a été envoyé à <strong>{email}</strong>. Ouvre-le dans ce même navigateur.
        </p>
      ) : (
        <form onSubmit={submit} className="auth__form">
          <label htmlFor="email">Adresse e-mail</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="btn btn--primary" disabled={state === 'sending'}>
            {state === 'sending' ? 'Envoi…' : 'Recevoir le lien de connexion'}
          </button>
          {state === 'error' && <p className="error">Envoi impossible : {error}</p>}
        </form>
      )}
    </main>
  )
}
