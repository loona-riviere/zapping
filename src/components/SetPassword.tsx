import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Status = 'idle' | 'saving' | 'done'

/**
 * Ajoute un mot de passe au compte déjà connecté (par ex. via Google) : un
 * filet de secours pour se reconnecter même quand l'OAuth coince, sans créer
 * un second compte séparé.
 */
export function SetPassword() {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')

  async function save(e: FormEvent) {
    e.preventDefault()
    setStatus('saving')
    setError('')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
      setStatus('idle')
      return
    }
    setStatus('done')
    setPassword('')
  }

  return (
    <div className="set-password-wrap">
      <button type="button" className="link-btn" onClick={() => setOpen((o) => !o)}>
        Mot de passe
      </button>
      {open && (
        <form onSubmit={save} className="auth__form set-password">
          <label htmlFor="new-password">Nouveau mot de passe</label>
          <input
            id="new-password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="auth__actions">
            <button className="btn btn--primary" disabled={status === 'saving'}>
              {status === 'saving' ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>
              Fermer
            </button>
          </div>
          {status === 'done' && <p className="muted">Mot de passe défini — tu peux t'en servir pour te connecter.</p>}
          {error && <p className="error">{error}</p>}
        </form>
      )}
    </div>
  )
}
