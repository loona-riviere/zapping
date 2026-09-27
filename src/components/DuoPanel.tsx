import { useState } from 'react'
import { nameOf } from '../lib/social'
import { useSocial } from '../lib/socialState'

/**
 * « 🔗 Cocher aussi pour Julien » sur la fiche d'une série : un interrupteur.
 * Allumé, chaque épisode coché ou décoché par l'un l'est chez l'autre. Pas
 * d'invitation à accepter ; un appui de plus l'éteint, pour les deux.
 */
export function DuoPanel({ show }: { show: { id: number; name: string; image: string | null } }) {
  const { socialReady, profile, friends, duos, duoFor, profileOf, linkDuo, stopDuo } = useSocial()
  const [picking, setPicking] = useState(false)
  if (!socialReady || !profile || duos === null) return null

  const d = duoFor(show.id)
  if (d) {
    const partner = profileOf(d.partnerId)
    const who = partner ? nameOf(partner) : 'ton ami·e'
    return (
      <button
        type="button"
        className="pill pill--on"
        aria-pressed="true"
        title="Chaque épisode coché ou décoché l'est aussi chez l'autre"
        onClick={() => confirm(`Ne plus cocher ${show.name} pour ${who} ? Chacun garde ses épisodes.`) && stopDuo(d)}
      >
        🔗 Cochée aussi pour {who}
      </button>
    )
  }

  if (!friends.length) return null
  if (friends.length === 1) {
    const f = friends[0]
    return (
      <button type="button" className="pill" aria-pressed="false" onClick={() => linkDuo(show, f)}>
        🔗 Cocher aussi pour {nameOf(f)}
      </button>
    )
  }
  if (!picking) {
    return (
      <button type="button" className="pill" onClick={() => setPicking(true)}>
        🔗 Cocher aussi pour…
      </button>
    )
  }
  return (
    <div className="duo">
      <p>Chaque épisode que tu coches sur {show.name} le sera aussi chez…</p>
      <div className="duo__friends">
        {friends.map((f) => (
          <button key={f.user_id} className="btn btn--ghost" onClick={() => linkDuo(show, f).then(() => setPicking(false))}>
            {nameOf(f)}
          </button>
        ))}
        <button className="link-btn muted" onClick={() => setPicking(false)}>Annuler</button>
      </div>
    </div>
  )
}
