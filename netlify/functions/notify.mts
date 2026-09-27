import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

// Côté serveur, pas de temps réel : sur un Node sans WebSocket natif (< 22),
// supabase-js refuse sinon de se créer (« native WebSocket not found »). Le
// transport fourni n'est jamais utilisé, on ne s'abonne à rien.
const SERVER_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: class {} as unknown as typeof WebSocket },
}

// Notifs entre amis : demande reçue, demande acceptée, recommandation,
// invitation à regarder une série à deux. L'app appelle cette fonction juste
// après l'action ; la fonction ne croit que la base : l'événement doit y être
// (et récent pour une recommandation), sinon rien n'est envoyé. Impossible
// donc de faire recevoir à quelqu'un une notif pour une action inventée.
//
// Variables Netlify requises (portée Functions) : SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.

type Body = { event?: string; to?: string; kind?: string; itemId?: string; showId?: number; movieId?: number; commentId?: number }
type SubRow = { endpoint: string; p256dh: string; auth_key: string }

const RECENT_MS = 10 * 60 * 1000

export default async (req: Request) => {
  try {
    return await handle(req)
  } catch (e) {
    console.error('notify: plantage', e)
    return Response.json({ sent: 0, reason: `Erreur serveur : ${(e as Error).message}` }, { status: 500 })
  }
}

async function handle(req: Request): Promise<Response> {
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
  const db = createClient(supabaseUrl, serviceKey, SERVER_OPTIONS)

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
  const toSelfOk = isTest || body.event === 'comment'
  if (!to || (to === me && !toSelfOk) || !/^[0-9a-f-]{36}$/i.test(to)) return new Response(null, { status: 400 })

  const { data: sender } = await db.from('profiles').select('username, display_name').eq('user_id', me).maybeSingle()
  const who = sender?.display_name?.trim() || (sender ? `@${sender.username}` : 'Quelqu’un')

  let payload: { title: string; body: string; url: string } | null = null
  // Par défaut un seul destinataire ; un commentaire va à plusieurs amis.
  let recipients: string[] = [to]
  // Envois supplémentaires, avec leur propre texte (amis tagués dans un commentaire).
  const extra: { to: string[]; payload: { title: string; body: string; url: string } }[] = []

  if (body.event === 'comment' && typeof body.commentId === 'number') {
    // Mon commentaire, tout juste publié : on prévient mes amis qui ont ce titre.
    const { data: c } = await db
      .from('comments')
      .select('kind, item_id, show_id, title, body, spoiler, created_at')
      .eq('id', body.commentId)
      .eq('user_id', me)
      .maybeSingle()
    if (c && Date.now() - new Date(c.created_at).getTime() < RECENT_MS) {
      const { data: fs } = await db
        .from('friendships')
        .select('requester, addressee')
        .eq('status', 'accepted')
        .or(`requester.eq.${me},addressee.eq.${me}`)
      const friendIds = (fs ?? []).map((f) => (f.requester === me ? f.addressee : f.requester))
      let having: string[] = []
      if (friendIds.length) {
        const q =
          c.kind === 'episode'
            ? db.from('tracked_shows').select('user_id').eq('show_id', c.show_id)
            : c.kind === 'movie'
              ? db.from('watched_movies').select('user_id').eq('movie_id', Number(c.item_id))
              : db.from('tracked_books').select('user_id').eq('book_id', c.item_id)
        const { data: rows } = await q.in('user_id', friendIds)
        having = [...new Set((rows ?? []).map((r) => r.user_id as string))]
      }
      // Amis tagués (@pseudo) : leur propre notif, qu'ils aient le titre ou non.
      const tags = [...new Set([...c.body.matchAll(/@([a-z0-9._]{3,20})/gi)].map((m) => m[1].toLowerCase()))]
      let tagged: string[] = []
      if (tags.length && friendIds.length) {
        const { data: ps } = await db.from('profiles').select('user_id, username').in('user_id', friendIds)
        tagged = (ps ?? []).filter((p) => tags.includes(String(p.username).toLowerCase())).map((p) => p.user_id as string)
      }
      recipients = having.filter((u) => !tagged.includes(u))
      const url =
        c.kind === 'episode' ? `/#/show/${c.show_id}/ep/${c.item_id}` : c.kind === 'movie' ? `/#/movie/${c.item_id}` : `/#/livre/${encodeURIComponent(c.item_id)}`
      payload = {
        title: `${who} a commenté ${c.title}`,
        // Un épisode peut divulgâcher : on ne recopie pas le texte dans la notif.
        body: c.kind === 'episode' || c.spoiler ? 'Ouvre pour lire (attention aux spoilers).' : c.body.slice(0, 140),
        url,
      }
      if (tagged.length) {
        extra.push({
          to: tagged,
          payload: {
            title: `${who} t’a mentionné·e`,
            body: `Dans un commentaire sur ${c.title}${c.kind === 'episode' || c.spoiler ? ' (attention aux spoilers)' : ` : ${c.body.slice(0, 120)}`}`,
            url,
          },
        })
      }
    }
  } else if (isTest) {
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
      // Pas envoyé tout de suite : regroupé avec les suivants (tâche flush-notifs).
      await db.from('notif_queue').insert({ recipient: to, sender: me, label: theirs.title, url: `/#/movie/${body.movieId}` })
      return Response.json({ sent: 0, queued: true })
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
      await db.from('notif_queue').insert({ recipient: to, sender: me, label: data.name, url: `/#/show/${body.showId}` })
      return Response.json({ sent: 0, queued: true })
    }
  }

  if (!payload) return Response.json({ sent: 0, reason: 'Rien à notifier' })

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
  const batches = [{ to: recipients, payload }, ...extra].filter((x) => x.to.length)
  if (!batches.length) return Response.json({ sent: 0, reason: 'Personne à prévenir' })
  let sent = 0
  let devices = 0
  const errors: string[] = []
  for (const batch of batches) {
    const { data: subs } = await db.from('push_subscriptions').select('endpoint, p256dh, auth_key').in('user_id', batch.to)
    devices += subs?.length ?? 0
    for (const sub of (subs ?? []) as SubRow[]) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          JSON.stringify(batch.payload),
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
  }
  return Response.json({
    sent,
    reason: !devices ? 'Aucun appareil abonné' : sent ? undefined : `Envoi refusé : ${errors.join(' | ')}`,
  })
}
