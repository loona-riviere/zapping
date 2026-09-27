import { useState } from 'react'
import { nameOf } from '../lib/social'
import { useSocial } from '../lib/socialState'

/**
 * « À deux » sur la fiche d'une série : proposer à un ami de la regarder
 * ensemble, accepter une proposition, ou arrêter. Une fois acceptée,
 * chaque épisode coché ou décoché par l'un l'est pour l'autre.
 */
export function DuoPanel({ show }: { show: { id: number; name: string; image: string | null } }) {
  const { socialReady, profile, friends, duos, duoFor, profileOf, inviteDuo, acceptDuo, stopDuo } = useSocial()
  const [picking, setPicking] = useState(false)
  if (!socialReady || !profile || duos === null) return null
  const d = duoFor(show.id)
  const partner = d ? profileOf(d.partnerId) : undefined
  const partnerName = partner ? nameOf(partner) : 'ton ami·e'

  if (d?.status === 'accepted') {
    return (
      <div className="duo">
        <p>
          👫 <strong>À deux avec {partnerName}</strong> : chaque épisode coché ou décoché l'est pour vous deux.
        </p>
        <button
          className="link-btn muted"
          onClick={() =>
            confirm(`Arrêter de regarder ${show.name} à deux ? Chacun garde ses épisodes cochés.`) && stopDuo(d)
          }
        >
          Arrêter
        </button>
      </div>
    )
  }
  if (d?.status === 'pending' && d.sentByMe) {
    return (
      <div className="duo">
        <p>👫 Invitation envoyée à {partnerName} pour regarder {show.name} à deux.</p>
        <button className="link-btn muted" onClick={() => stopDuo(d)}>Annuler</button>
      </div>
    )
  }
  if (d?.status === 'pending') {
    return (
      <div className="duo duo--invite">
        <p>
          👫 <strong>{partnerName}</strong> te propose de regarder {show.name} à deux. Vos épisodes cochés
          seront mis en commun, puis chaque coche vaudra pour vous deux.
        </p>
        <div className="movie__actions">
          <button className="btn btn--primary" onClick={() => acceptDuo(d)}>Accepter</button>
          <button className="link-btn muted" onClick={() => stopDuo(d)}>Refuser</button>
        </div>
      </div>
    )
  }
  if (!friends.length) return null
  if (!picking) {
    return (
      <button className="btn btn--ghost duo__start" onClick={() => setPicking(true)}>
        👫 Regarder à deux…
      </button>
    )
  }
  return (
    <div className="duo">
      <p>Avec qui regardes-tu {show.name} ?</p>
      <div className="duo__friends">
        {friends.map((f) => (
          <button
            key={f.user_id}
            className="btn btn--ghost"
            onClick={async () => {
              await inviteDuo(show, f)
              setPicking(false)
            }}
          >
            {nameOf(f)}
          </button>
        ))}
        <button className="link-btn muted" onClick={() => setPicking(false)}>Annuler</button>
      </div>
    </div>
  )
}
