import { mutedFor, sendPush, setupPush, type PushPayload, type SubRow } from '../lib/push'

// Toutes les 5 minutes : envoie en une seule notif les « vu ensemble » mis en
// attente par notify, une fois que l'expéditeur a fini (plus rien d'ajouté
// depuis QUIET). Cocher dix films à la suite = une notif, pas dix.
export const config = { schedule: '*/5 * * * *' }

const QUIET_MS = 3 * 60 * 1000

type Row = { id: number; recipient: string; sender: string; label: string; url: string; created_at: string }

export default async () => {
  const { db, missing } = setupPush()
  if (!db) {
    console.error(`flush-notifs: variables manquantes : ${missing.join(', ')}`)
    return
  }

  const { data } = await db.from('notif_queue').select('*').order('created_at')
  const groups = new Map<string, Row[]>()
  for (const r of (data ?? []) as Row[]) groups.set(`${r.recipient}|${r.sender}`, [...(groups.get(`${r.recipient}|${r.sender}`) ?? []), r])

  for (const rows of groups.values()) {
    const last = Math.max(...rows.map((r) => new Date(r.created_at).getTime()))
    if (Date.now() - last < QUIET_MS) continue // encore en train de cocher

    const { recipient, sender } = rows[0]
    // « Vu ensemble » coupé dans ses Paramètres : on jette sans envoyer.
    if ((await mutedFor(db, [recipient], 'together')).size) {
      await db.from('notif_queue').delete().in('id', rows.map((r) => r.id))
      continue
    }
    const { data: p } = await db.from('profiles').select('*').eq('user_id', sender).maybeSingle()
    const who = p?.display_name?.trim() || (p ? `@${p.username}` : 'Un ami')
    const labels = [...new Set(rows.map((r) => r.label))]
    const icon = typeof p?.avatar_url === 'string' ? p.avatar_url : undefined
    // « Dune, Severance et The Bear » ; au-delà de 3 : « …, The Bear et 2 autres ».
    const list =
      labels.length <= 3
        ? labels.slice(0, -1).join(', ') + ' et ' + labels[labels.length - 1]
        : `${labels.slice(0, 3).join(', ')} et ${labels.length - 3} autre${labels.length > 4 ? 's' : ''}`
    const payload: PushPayload =
      labels.length === 1
        ? { title: `🍿 ${who} a vu ${labels[0]} avec toi`, body: '', url: rows[0].url, icon }
        : { title: `🍿 Vu ensemble avec ${who}`, body: list, url: '/#/', icon }

    const { data: subs } = await db.from('push_subscriptions').select('endpoint, p256dh, auth_key').eq('user_id', recipient)
    await sendPush(db, (subs ?? []) as SubRow[], payload)
    await db.from('notif_queue').delete().in('id', rows.map((r) => r.id))
  }
}
