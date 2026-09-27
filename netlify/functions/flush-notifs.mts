import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

// Toutes les 5 minutes : envoie en une seule notif les « vu ensemble » mis en
// attente par notify, une fois que l'expéditeur a fini (plus rien d'ajouté
// depuis QUIET). Cocher dix films à la suite = une notif, pas dix.
export const config = { schedule: '*/5 * * * *' }

const QUIET_MS = 3 * 60 * 1000

const SERVER_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: class {} as unknown as typeof WebSocket },
}

type Row = { id: number; recipient: string; sender: string; label: string; url: string; created_at: string }
type SubRow = { endpoint: string; p256dh: string; auth_key: string }

export default async () => {
  const supabaseUrl = Netlify.env.get('SUPABASE_URL') || Netlify.env.get('VITE_SUPABASE_URL')
  const serviceKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const vapidPublic = Netlify.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate = Netlify.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Netlify.env.get('VAPID_SUBJECT')
  if (!supabaseUrl || !serviceKey || !vapidPublic || !vapidPrivate || !vapidSubject) return
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
  const db = createClient(supabaseUrl, serviceKey, SERVER_OPTIONS)

  const { data } = await db.from('notif_queue').select('*').order('created_at')
  const groups = new Map<string, Row[]>()
  for (const r of (data ?? []) as Row[]) groups.set(`${r.recipient}|${r.sender}`, [...(groups.get(`${r.recipient}|${r.sender}`) ?? []), r])

  for (const rows of groups.values()) {
    const last = Math.max(...rows.map((r) => new Date(r.created_at).getTime()))
    if (Date.now() - last < QUIET_MS) continue // encore en train de cocher

    const { recipient, sender } = rows[0]
    const { data: p } = await db.from('profiles').select('username, display_name').eq('user_id', sender).maybeSingle()
    const who = p?.display_name?.trim() || (p ? `@${p.username}` : 'Un ami')
    const labels = [...new Set(rows.map((r) => r.label))]
    const payload =
      labels.length === 1
        ? { title: 'Vu ensemble', body: `${who} a noté que vous avez vu ${labels[0]} ensemble.`, url: rows[0].url }
        : {
            title: 'Vu ensemble',
            body: `${who} a noté ${labels.length} titres vus ensemble : ${labels.slice(0, 3).join(', ')}${labels.length > 3 ? '…' : ''}`,
            url: '/#/',
          }

    const { data: subs } = await db.from('push_subscriptions').select('endpoint, p256dh, auth_key').eq('user_id', recipient)
    for (const sub of (subs ?? []) as SubRow[]) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, JSON.stringify(payload))
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      }
    }
    await db.from('notif_queue').delete().in('id', rows.map((r) => r.id))
  }
}
