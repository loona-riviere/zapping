import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

// Notifs entre amis : demande reçue, demande acceptée, recommandation,
// invitation à regarder une série à deux. L'app appelle cette fonction juste
// après l'action ; la fonction ne croit que la base : l'événement doit y être
// (et récent pour une recommandation), sinon rien n'est envoyé. Impossible
// donc de faire recevoir à quelqu'un une notif pour une action inventée.

type Body = { event?: string; to?: string; kind?: string; itemId?: string; showId?: number; movieId?: number }
type SubRow = { endpoint: string; p256dh: string; auth_key: string }

const RECENT_MS = 10 * 60 * 1000

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 })
  const supabaseUrl = Netlify.env.get('SUPABASE_URL') || Netlify.env.get('VITE_SUPABASE_URL')
  const serviceKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const vapidPublic = Netlify.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate = Netlify.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Netlify.env.get('VAPID_SUBJECT')
  const missing = Object.entries({
    SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    VAPID_PUBLIC_KEY: vapidPublic, VAPID_PRIVATE_KEY: vapidPrivate, VAPID_SUBJECT: vapidSubject,
  }).filter(([, v]) => !v).map(([k]) => k)
  if (!supabaseUrl || !serviceKey || !vapidPublic || !vapidPrivate || !vapidSubject) {
    console.error(`notify: variables manquantes : ${missing.join(', ')}`)
    return Response.json({ sent: 0, reason: `Variables Netlify manquantes : ${missing.join(', ')}` }, { status: 500 })
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
  const isTest = body.event === 'test'
  if (!to || (to === me && !isTest) || !/^[0-9a-f-]{36}$/i.test(to)) return new Response(null, { status: 400 })

  const { data: sender } = await db.from('profiles').select('username, display_name').eq('user_id', me).maybeSingle()
  const who = sender?.display_name?.trim() || (sender ? `@${sender.username}` : 'Quelqu’un')

  let payload: { title: string; body: string; url: string } | null = null

  if (isTest) {
    if (to === me) payload = { title: 'Zapping', body: 'Les notifications marchent 🎉', url: '/#/parametres' }
  } else if (body.event === 'friend_request') {
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
      .select('show_name')
      .eq('show_id', body.showId)
      .eq('inviter', me)
      .eq('invitee', to)
      .maybeSingle()
    if (data) {
      payload = { title: 'Série cochée à deux', body: `${who} coche désormais ${data.show_name} pour vous deux.`, url: `/#/show/${body.showId}` }
    }
  } else if (body.event === 'movie_together' && typeof body.movieId === 'number') {
    // Le film doit être vu des deux côtés, le même jour.
    const { data: rows } = await db
      .from('watched_movies')
      .select('user_id, title, watched_at, status')
      .eq('movie_id', body.movieId)
      .in('user_id', [me, to])
    const mine = rows?.find((r) => r.user_id === me)
    const theirs = rows?.find((r) => r.user_id === to)
    const day = (d: string | null) => (d ? d.slice(0, 10) : null)
    if (mine && theirs && theirs.status === 'watched' && day(mine.watched_at) === day(theirs.watched_at)) {
      payload = { title: 'Vu ensemble', body: `${who} a noté que vous avez vu ${theirs.title} ensemble.`, url: `/#/movie/${body.movieId}` }
    }
  } else if (body.event === 'show_together' && typeof body.showId === 'number') {
    const { data } = await db
      .from('tracked_shows')
      .select('name')
      .eq('user_id', to)
      .eq('show_id', body.showId)
      .maybeSingle()
    const { data: friends } = await db
      .from('friendships')
      .select('status')
      .eq('status', 'accepted')
      .or(`and(requester.eq.${me},addressee.eq.${to}),and(requester.eq.${to},addressee.eq.${me})`)
    if (data && friends?.length) {
      payload = { title: 'Vu ensemble', body: `${who} a coché chez toi des épisodes de ${data.name} vus ensemble.`, url: `/#/show/${body.showId}` }
    }
  }

  if (!payload) return Response.json({ sent: 0, reason: 'Rien à notifier' })

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
  const { data: subs } = await db.from('push_subscriptions').select('endpoint, p256dh, auth_key').eq('user_id', to)
  let sent = 0
  const errors: string[] = []
  for (const sub of (subs ?? []) as SubRow[]) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
        JSON.stringify(payload),
      )
      sent++
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      const detail = (e as { body?: string }).body ?? (e as Error).message
      console.error(`notify: envoi refusé (${status ?? '?'}) ${detail}`)
      errors.push(`${status ?? '?'} ${detail}`.slice(0, 200))
      if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    }
  }
  return Response.json({
    sent,
    reason: !subs?.length ? 'Aucun appareil abonné' : sent ? undefined : `Envoi refusé : ${errors.join(' | ')}`,
  })
}
