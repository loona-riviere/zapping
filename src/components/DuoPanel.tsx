import { useState } from 'react'
import { useApp } from '../lib/appState'
import type { Duo } from '../lib/duo'
import { nameOf, type Profile } from '../lib/social'
import { useSocial } from '../lib/socialState'

/**
 * « À deux » sur la fiche d'une série : un visionnage fait ensemble, une
 * première vision ou un revisionnage. Une fois accepté, chaque épisode coché
 * ou décoché par l'un pendant ce visionnage l'est pour l'autre ; ce que
 * chacun a vu avant reste à lui.
 *
 * Qui a déjà vu des épisodes choisit si c'est un revisionnage (sa progression
 * repart de zéro, son historique ne bouge pas) ou la suite de son visionnage.
 */
export function DuoPanel({ show }: { show: { id: number; name: string; image: string | null } }) {
  const { socialReady, profile, friends, duos, duoFor, profileOf, inviteDuo, acceptDuo, stopDuo } = useSocial()
  const { historyFor, isRewatching, startRewatch } = useApp()
  const [picking, setPicking] = useState(false)
  // Action en attente du choix « revisionnage ou suite ».
  const [pending, setPending] = useState<{ kind: 'invite'; friend: Profile } | { kind: 'accept'; duo: Duo } | null>(null)
  if (!socialReady || !profile || duos === null) return null

  const d = duoFor(show.id)
  const partner = d ? profileOf(d.partnerId) : undefined
  const partnerName = partner ? nameOf(partner) : 'ton ami·e'
  const rewatching = isRewatching(show.id)
  // Déjà des épisodes vus, hors revisionnage : il faut savoir quel visionnage on partage.
  const mustChoose = historyFor(show.id).size > 0 && !rewatching

  async function go(action: NonNullable<typeof pending>, asRewatch: boolean) {
    if (asRewatch) await startRewatch(show.id)
    if (action.kind === 'invite') await inviteDuo(show, action.friend)
    else await acceptDuo(action.duo)
    setPending(null)
    setPicking(false)
  }
  const start = (action: NonNullable<typeof pending>) => (mustChoose ? setPending(action) : go(action, false))

  if (pending) {
    return (
      <div className="duo duo--invite">
        <p>Tu as déjà vu des épisodes de {show.name}. Ce visionnage à deux, pour toi, c'est…</p>
        <div className="duo__friends">
          <button className="btn btn--primary" onClick={() => go(pending, true)}>Un revisionnage</button>
          <button className="btn btn--ghost" onClick={() => go(pending, false)}>La suite de mon visionnage</button>
          <button className="link-btn muted" onClick={() => setPending(null)}>Annuler</button>
        </div>
        <p className="muted" style={{ fontSize: '.8rem' }}>
          Revisionnage : ta progression repart de zéro, ton historique ne bouge pas.
        </p>
      </div>
    )
  }

  if (d?.status === 'accepted') {
    return (
      <div className="duo">
        <p>
          👫 <strong>À deux avec {partnerName}</strong>
          {rewatching ? ' (revisionnage)' : ''} : chaque épisode coché ou décoché pendant ce visionnage l'est
          pour vous deux.
        </p>
        <button
          className="link-btn muted"
          onClick={() => confirm(`Arrêter de regarder ${show.name} à deux ? Chacun garde ses épisodes cochés.`) && stopDuo(d)}
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
          👫 <strong>{partnerName}</strong> te propose de regarder {show.name} à deux : les épisodes que
          vous cocherez pendant ce visionnage vaudront pour vous deux.
        </p>
        <div className="movie__actions">
          <button className="btn btn--primary" onClick={() => start({ kind: 'accept', duo: d })}>Accepter</button>
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
          <button key={f.user_id} className="btn btn--ghost" onClick={() => start({ kind: 'invite', friend: f })}>
            {nameOf(f)}
          </button>
        ))}
        <button className="link-btn muted" onClick={() => setPicking(false)}>Annuler</button>
      </div>
    </div>
  )
}
