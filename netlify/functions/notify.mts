import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

// Notifs entre amis : demande reçue, demande acceptée, recommandation,
// invitation à regarder une série à deux. L'app appelle cette fonction juste
// après l'action ; la fonction ne croit que la base : l'événement doit y être
// (et récent pour une recommandation), sinon rien n'est envoyé. Impossible
// donc de faire recevoir à quelqu'un une notif pour une action inventée.

type Body = { event?: string; to?: string; kind?: string; itemId?: string; showId?: number }
type SubRow = { endpoint: string; p256dh: string; auth_key: string }

const RECENT_MS = 10 * 60 * 1000

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 })
  const supabaseUrl = Netlify.env.get('SUPABASE_URL') || Netlify.env.get('VITE_SUPABASE_URL')
  const serviceKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const vapidPublic = Netlify.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate = Netlify.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Netlify.env.get('VAPID_SUBJECT')
  if (!supabaseUrl || !serviceKey || !vapidPublic || !vapidPrivate || !vapidSubject) {
    console.error('notify: variables manquantes')
    return new Response(null, { status: 204 })
  }
  const db = createClient(supabaseUrl, serviceKey)

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return new Response(null, { status: 401 })
  const { data: auth } = await db.auth.getUser(token)
  const me = auth.user?.id
  if (!me) return new Response(null, { status: 401 })

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return new Response(null, { status: 400 })
  }
  const to = body.to
  if (!to || to === me) return new Response(null, { status: 400 })

  const { data: sender } = await db.from('profiles').select('username, display_name').eq('user_id', me).maybeSingle()
  const who = sender?.display_name?.trim() || (sender ? `@${sender.username}` : 'Quelqu’un')

  let payload: { title: string; body: string; url: string } | null = null

  if (body.event === 'friend_request') {
    const { data } = await db
      .from('friendships')
      .select('status')
      .eq('requester', me)
      .eq('addressee', to)
      .eq('status', 'pending')
      .maybeSingle()
    if (data) payload = { title: 'Demande d’ami', body: `${who} veut t’ajouter sur Zapping.`, url: '/#/amis' }
  } else if (body.event === 'friend_accept') {
    const { data } = await db
      .from('friendships')
      .select('status')
      .eq('requester', to)
      .eq('addressee', me)
      .eq('status', 'accepted')
      .maybeSingle()
    if (data) payload = { title: 'Nouvel ami', body: `${who} a accepté ta demande.`, url: '/#/amis' }
  } else if (body.event === 'rec' && body.kind && body.itemId) {
    const { data } = await db
      .from('recommendations')
      .select('title, note, created_at')
      .eq('sender', me)
      .eq('recipient', to)
      .eq('kind', body.kind)
      .eq('item_id', body.itemId)
      .maybeSingle()
    if (data && Date.now() - new Date(data.created_at).getTime() < RECENT_MS) {
      const what = body.kind === 'book' ? 'un livre' : body.kind === 'movie' ? 'un film' : 'une série'
      payload = {
        title: `${who} te recommande ${what}`,
        body: data.note ? `${data.title} — « ${data.note} »` : data.title,
        url: '/#/amis',
      }
    }
  } else if (body.event === 'duo' && typeof body.showId === 'number') {
    const { data } = await db
      .from('shared_shows')
      .select('show_name, status')
      .eq('show_id', body.showId)
      .eq('inviter', me)
      .eq('invitee', to)
      .eq('status', 'pending')
      .maybeSingle()
    if (data) {
      payload = { title: 'Série à deux', body: `${who} te propose de regarder ${data.show_name} ensemble.`, url: `/#/show/${body.showId}` }
    }
  }

  if (!payload) return new Response(null, { status: 204 })

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
  const { data: subs } = await db.from('push_subscriptions').select('endpoint, p256dh, auth_key').eq('user_id', to)
  for (const sub of (subs ?? []) as SubRow[]) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
        JSON.stringify(payload),
      )
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    }
  }
  return new Response(null, { status: 204 })
}
