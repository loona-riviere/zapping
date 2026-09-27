-- Zapping : schéma Supabase
-- À exécuter dans l'éditeur SQL de ton projet Supabase.
-- Le script est ré-exécutable : tu peux le relancer après une mise à jour.

create table if not exists public.tracked_shows (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  show_id integer not null,            -- identifiant TVmaze
  name text not null,
  image_url text,
  added_at timestamptz not null default now(),
  last_watched_at timestamptz,
  primary key (user_id, show_id)
);

-- Statut de suivi : en cours, en pause, à regarder plus tard, abandonnée.
alter table public.tracked_shows
  add column if not exists status text not null default 'watching';

-- Nombre de fois où la série a été revue en entier, en plus du premier
-- visionnage. Une série vue trois fois porte donc 2.
alter table public.tracked_shows
  add column if not exists rewatches integer not null default 0;

alter table public.tracked_shows drop constraint if exists tracked_shows_rewatches_check;
alter table public.tracked_shows
  add constraint tracked_shows_rewatches_check check (rewatches >= 0);

-- Vrai pendant un revisionnage en cours : la progression est alors suivie dans
-- rewatch_progress, sans toucher à l'historique de watched_episodes.
alter table public.tracked_shows
  add column if not exists rewatching boolean not null default false;

alter table public.tracked_shows drop constraint if exists tracked_shows_status_check;
alter table public.tracked_shows
  add constraint tracked_shows_status_check
  check (status in ('watching', 'paused', 'later', 'dropped'));

create table if not exists public.watched_episodes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  episode_id integer not null,         -- identifiant TVmaze
  show_id integer not null,
  season integer not null,
  number integer not null,
  watched_at timestamptz not null default now(),
  primary key (user_id, episode_id)
);

-- La date peut être inconnue : « vu, mais je ne sais plus quand ». Une reprise
-- en masse sans date ne doit pas inventer celle du jour, qui ferait un faux pic
-- dans les statistiques.
alter table public.watched_episodes alter column watched_at drop not null;

create index if not exists watched_episodes_user_show_idx
  on public.watched_episodes (user_id, show_id);

-- Rattache chaque épisode coché à sa série suivie : sans cette FK, l'éditeur
-- de tables Supabase ne sait pas relier les deux et n'affiche pas la flèche
-- de navigation vers watched_episodes depuis tracked_shows.
alter table public.watched_episodes drop constraint if exists watched_episodes_show_fkey;
alter table public.watched_episodes
  add constraint watched_episodes_show_fkey
  foreign key (user_id, show_id) references public.tracked_shows (user_id, show_id)
  on delete cascade;

-- Épisodes revus pendant le visionnage en cours. La table est vidée à la fin
-- du revisionnage, qui incrémente alors tracked_shows.rewatches : on ne garde
-- que la passe en cours, pas l'historique de chaque passe.
create table if not exists public.rewatch_progress (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  show_id integer not null,
  episode_id integer not null,
  watched_at timestamptz default now(),
  primary key (user_id, episode_id)
);

create index if not exists rewatch_progress_user_show_idx
  on public.rewatch_progress (user_id, show_id);

alter table public.rewatch_progress drop constraint if exists rewatch_progress_show_fkey;
alter table public.rewatch_progress
  add constraint rewatch_progress_show_fkey
  foreign key (user_id, show_id) references public.tracked_shows (user_id, show_id)
  on delete cascade;

-- Recalcule last_watched_at à partir de la vraie date la plus récente parmi
-- les épisodes datés de la série. Un simple « bump » qui ne ferait que monter
-- se bloquait après un « Dater à la diffusion » ou « Dater tout à… » : ces
-- corrections en masse peuvent au contraire faire reculer la date la plus
-- récente (ex. Ted Lasso redaté à sa diffusion d'origine, plus ancienne
-- qu'un test manuel horodaté à aujourd'hui), ce qu'un simple maximum
-- empêchait à tort.
-- security invoker : s'exécute avec les droits de l'appelant, RLS comprise.
create or replace function public.sync_last_watched(p_show_id integer)
returns void
language sql
security invoker
as $$
  update public.tracked_shows
  set last_watched_at = (
    select max(watched_at) from public.watched_episodes
    where show_id = p_show_id and user_id = auth.uid()
  )
  where show_id = p_show_id and user_id = auth.uid();
$$;

drop function if exists public.bump_last_watched(integer, timestamptz);

-- Films vus (catalogue TMDB).
create table if not exists public.watched_movies (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  movie_id integer not null,           -- identifiant TMDB
  title text not null,
  poster_url text,
  release_year integer,
  watched_at timestamptz not null default now(),
  primary key (user_id, movie_id)
);

-- La date peut être inconnue : « vu, mais je ne sais plus quand ». Mieux vaut
-- l'absence de date qu'une date inventée, qui fausserait les statistiques.
alter table public.watched_movies alter column watched_at drop not null;

-- Durée en minutes, pour le temps total des statistiques. TMDB ne la donne pas
-- dans les résultats de recherche : elle demande une requête de détail, d'où
-- des lignes anciennes sans durée, complétées après coup.
alter table public.watched_movies add column if not exists runtime integer;

create index if not exists watched_movies_user_date_idx
  on public.watched_movies (user_id, watched_at desc);

-- « later » : un film ajouté à voir, pas encore vu — watched_at reste vide
-- tant qu'il n'est pas basculé sur « watched ».
alter table public.watched_movies add column if not exists status text not null default 'watched';
alter table public.watched_movies drop constraint if exists watched_movies_status_check;
alter table public.watched_movies
  add constraint watched_movies_status_check check (status in ('watched', 'later'));

-- Date de sortie complète (pas seulement l'année) : sert à ne pas proposer
-- de marquer vu un film pas encore sorti.
alter table public.watched_movies add column if not exists release_date date;

-- Notation façon Netflix (j'aime pas / j'aime / j'adore), pour affiner le
-- choix des recommandations : privilégier les séries/films adorés comme
-- amorce plutôt que le simple « vu récemment ».
alter table public.tracked_shows add column if not exists rating text;
alter table public.tracked_shows drop constraint if exists tracked_shows_rating_check;
alter table public.tracked_shows
  add constraint tracked_shows_rating_check check (rating is null or rating in ('dislike', 'like', 'love'));

alter table public.watched_movies add column if not exists rating text;
alter table public.watched_movies drop constraint if exists watched_movies_rating_check;
alter table public.watched_movies
  add constraint watched_movies_rating_check check (rating is null or rating in ('dislike', 'like', 'love'));

alter table public.tracked_shows enable row level security;
alter table public.watched_episodes enable row level security;
alter table public.rewatch_progress enable row level security;
alter table public.watched_movies enable row level security;

drop policy if exists "tracked_shows: own rows" on public.tracked_shows;
create policy "tracked_shows: own rows" on public.tracked_shows
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "watched_episodes: own rows" on public.watched_episodes;
create policy "watched_episodes: own rows" on public.watched_episodes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "rewatch_progress: own rows" on public.rewatch_progress;
create policy "rewatch_progress: own rows" on public.rewatch_progress
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Suggestions écartées dans « Recommandé pour toi » : en base plutôt qu'en
-- localStorage, pour que ça tienne d'un appareil à l'autre et que ce soit
-- consultable (et réversible) depuis les paramètres.
create table if not exists public.dismissed_recommendations (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('show', 'movie')),
  tmdb_id integer not null,
  name text not null,
  poster_url text,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, kind, tmdb_id)
);

alter table public.dismissed_recommendations enable row level security;

drop policy if exists "dismissed_recommendations: own rows" on public.dismissed_recommendations;
create policy "dismissed_recommendations: own rows" on public.dismissed_recommendations
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "watched_movies: own rows" on public.watched_movies;
create policy "watched_movies: own rows" on public.watched_movies
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Abonnements aux notifications push (Web Push), un par appareil/navigateur.
create table if not exists public.push_subscriptions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions: own rows" on public.push_subscriptions;
create policy "push_subscriptions: own rows" on public.push_subscriptions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Évite de renvoyer deux fois la même notif de nouvel épisode : une ligne par
-- épisode déjà notifié à un utilisateur. Écrite uniquement par la tâche
-- planifiée (clé service_role, hors RLS) ; en lecture pour l'utilisateur au
-- cas où on voudrait l'exposer un jour.
create table if not exists public.episode_notifications (
  user_id uuid not null references auth.users (id) on delete cascade,
  show_id integer not null,
  episode_id integer not null,
  notified_at timestamptz not null default now(),
  primary key (user_id, episode_id)
);

alter table public.episode_notifications enable row level security;

drop policy if exists "episode_notifications: own rows" on public.episode_notifications;
create policy "episode_notifications: own rows" on public.episode_notifications
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Dernière sélection Gemini par personne et par type, pour ne pas réinterroger
-- Gemini à chaque visite ni d'un appareil à l'autre. Écrite par la fonction
-- Netlify avec la session de la personne : chacun ne touche qu'à la sienne.
create table if not exists public.ai_recommendations (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('show', 'movie')),
  picks jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind)
);

alter table public.ai_recommendations enable row level security;

drop policy if exists "ai_recommendations: own rows" on public.ai_recommendations;
create policy "ai_recommendations: own rows" on public.ai_recommendations
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Livres : pile à lire, lecture en cours (avec la page atteinte), lus,
-- abandonnés. L'identifiant porte sa source en préfixe : « gb:… » pour
-- Google Books, « ol:… » pour Open Library.
create table if not exists public.tracked_books (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id text not null,
  title text not null,
  authors text,
  cover_url text,
  page_count integer,
  published_year integer,
  status text not null default 'later',
  current_page integer not null default 0,
  -- Dates inconnues permises : « lu, mais je ne sais plus quand ».
  started_at timestamptz,
  finished_at timestamptz,
  rating text,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

alter table public.tracked_books drop constraint if exists tracked_books_status_check;
alter table public.tracked_books
  add constraint tracked_books_status_check check (status in ('reading', 'read', 'later', 'dropped'));

alter table public.tracked_books drop constraint if exists tracked_books_rating_check;
alter table public.tracked_books
  add constraint tracked_books_rating_check check (rating is null or rating in ('dislike', 'like', 'love'));

alter table public.tracked_books drop constraint if exists tracked_books_pages_check;
alter table public.tracked_books
  add constraint tracked_books_pages_check check (current_page >= 0 and (page_count is null or page_count > 0));

create index if not exists tracked_books_user_updated_idx
  on public.tracked_books (user_id, updated_at desc);

alter table public.tracked_books enable row level security;

drop policy if exists "tracked_books: own rows" on public.tracked_books;
create policy "tracked_books: own rows" on public.tracked_books
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Ordre d'envie dans les listes « à voir / à lire », rangé à la main (glisser
-- la poignée). Plus petit = plus envie ; vide = pas encore rangé, en fin de
-- liste.
alter table public.tracked_shows add column if not exists wish_rank double precision;
alter table public.watched_movies add column if not exists wish_rank double precision;
alter table public.tracked_books add column if not exists wish_rank double precision;

-- Genre d'un livre, en français (Roman, Policier & thriller, SF & fantasy…),
-- deviné depuis les catégories du catalogue et corrigeable à la main : sert
-- aux statistiques de lecture par genre.
alter table public.tracked_books add column if not exists genre text;

-- ==================================================================== amis ==
-- Profils publics (pseudo), demandes d'amis, et lecture des bibliothèques
-- entre amis. Une amitié n'existe qu'une fois la demande acceptée : avant,
-- rien n'est visible de part et d'autre.

create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- Pseudo unique, en minuscules : sert à chercher quelqu'un et dans le lien d'invitation.
  username text not null unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Tout compte connecté peut trouver un profil par son pseudo (c'est le but),
-- mais chacun ne modifie que le sien.
drop policy if exists "profiles: read" on public.profiles;
create policy "profiles: read" on public.profiles
  for select to authenticated using (true);
drop policy if exists "profiles: own" on public.profiles;
create policy "profiles: own" on public.profiles
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table if not exists public.friendships (
  requester uuid not null references auth.users (id) on delete cascade,
  addressee uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);

alter table public.friendships enable row level security;

-- Chacun voit les demandes qui le concernent, n'envoie qu'en son nom et
-- « en attente », et peut retirer une amitié (ou refuser, ou annuler une
-- demande) de son côté comme de l'autre. Accepter passe par
-- accept_friend() : une règle d'update laisserait aussi changer l'auteur de
-- la demande, donc se déclarer ami de n'importe qui.
drop policy if exists "friendships: read" on public.friendships;
create policy "friendships: read" on public.friendships
  for select to authenticated
  using ((select auth.uid()) in (requester, addressee));
drop policy if exists "friendships: ask" on public.friendships;
create policy "friendships: ask" on public.friendships
  for insert to authenticated
  with check ((select auth.uid()) = requester and status = 'pending');
drop policy if exists "friendships: accept" on public.friendships;

-- Accepte une demande reçue, et rien d'autre.
create or replace function public.accept_friend(p_requester uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.friendships
  set status = 'accepted'
  where requester = p_requester and addressee = auth.uid() and status = 'pending';
$$;
revoke all on function public.accept_friend(uuid) from public, anon;
grant execute on function public.accept_friend(uuid) to authenticated;
drop policy if exists "friendships: remove" on public.friendships;
create policy "friendships: remove" on public.friendships
  for delete to authenticated
  using ((select auth.uid()) in (requester, addressee));

-- Vrai si la personne connectée est amie avec `other` (demande acceptée,
-- dans un sens ou l'autre). security definer : les règles d'accès des
-- bibliothèques l'appellent, et la ligne d'amitié n'est pas forcément
-- lisible sous les règles de friendships. Un seul paramètre : impossible
-- de s'en servir pour savoir si deux autres personnes sont amies.
drop function if exists public.is_friend(uuid, uuid);
create or replace function public.is_my_friend(other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester = auth.uid() and f.addressee = other) or (f.requester = other and f.addressee = auth.uid()))
  );
$$;
revoke all on function public.is_my_friend(uuid) from public, anon;
grant execute on function public.is_my_friend(uuid) to authenticated;

-- « Caché à mes amis », par série, film ou livre : les plaisirs coupables.
alter table public.tracked_shows add column if not exists hidden boolean not null default false;
alter table public.watched_movies add column if not exists hidden boolean not null default false;
alter table public.tracked_books add column if not exists hidden boolean not null default false;

-- Lecture seule des bibliothèques entre amis, hors éléments cachés. Ces
-- règles s'ajoutent à « own rows » (qui reste seule à permettre d'écrire).
drop policy if exists "tracked_shows: friends read" on public.tracked_shows;
create policy "tracked_shows: friends read" on public.tracked_shows
  for select to authenticated
  using (not hidden and public.is_my_friend(user_id));
drop policy if exists "watched_movies: friends read" on public.watched_movies;
create policy "watched_movies: friends read" on public.watched_movies
  for select to authenticated
  using (not hidden and public.is_my_friend(user_id));
drop policy if exists "tracked_books: friends read" on public.tracked_books;
create policy "tracked_books: friends read" on public.tracked_books
  for select to authenticated
  using (not hidden and public.is_my_friend(user_id));
-- Épisodes vus d'un ami, pour « où il en est », seulement pour ses séries non cachées.
drop policy if exists "watched_episodes: friends read" on public.watched_episodes;
create policy "watched_episodes: friends read" on public.watched_episodes
  for select to authenticated
  using (
    public.is_my_friend(user_id)
    and exists (
      select 1 from public.tracked_shows t
      where t.user_id = watched_episodes.user_id and t.show_id = watched_episodes.show_id and not t.hidden
    )
  );

-- ========================================================= séries à deux ==
-- Un visionnage fait à deux (en couple, entre amis) : une première vision
-- ou un revisionnage d'une série, ensemble. Une fois l'invitation acceptée,
-- chaque épisode coché ou décoché par l'un pendant ce visionnage l'est pour
-- l'autre — dans son revisionnage en cours s'il en a un, sinon dans son
-- historique. Ce que chacun a vu avant reste à lui : rien n'est fusionné.
-- On n'écrit dans la liste de l'autre que par les fonctions ci-dessous, et
-- seulement pour une série acceptée à deux.

create table if not exists public.shared_shows (
  show_id integer not null,
  inviter uuid not null references auth.users (id) on delete cascade,
  invitee uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  -- Nom et affiche, pour afficher l'invitation sans rien aller chercher.
  show_name text not null,
  image_url text,
  created_at timestamptz not null default now(),
  primary key (show_id, inviter, invitee),
  check (inviter <> invitee)
);

alter table public.shared_shows enable row level security;

drop policy if exists "shared_shows: read" on public.shared_shows;
create policy "shared_shows: read" on public.shared_shows
  for select to authenticated
  using ((select auth.uid()) in (inviter, invitee));
-- « Cocher aussi pour un ami » : un lien posé en son nom, avec un ami, sans
-- invitation à accepter (les anciennes invitations en attente sont acceptées).
drop policy if exists "shared_shows: invite" on public.shared_shows;
create policy "shared_shows: invite" on public.shared_shows
  for insert to authenticated
  with check ((select auth.uid()) = inviter and public.is_my_friend(invitee));
update public.shared_shows set status = 'accepted' where status = 'pending';
drop policy if exists "shared_shows: stop" on public.shared_shows;
create policy "shared_shows: stop" on public.shared_shows
  for delete to authenticated
  using ((select auth.uid()) in (inviter, invitee));

-- Partenaires à deux de la personne connectée pour une série.
create or replace function public.duo_partners(p_show_id integer)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when inviter = auth.uid() then invitee else inviter end
  from public.shared_shows
  where show_id = p_show_id and status = 'accepted' and auth.uid() in (inviter, invitee);
$$;
revoke all on function public.duo_partners(integer) from public, anon;
grant execute on function public.duo_partners(integer) to authenticated;

-- Accepte une invitation reçue. La série est ajoutée chez l'un et l'autre
-- s'il le faut ; les épisodes déjà vus ne sont pas mis en commun.
create or replace function public.accept_shared_show(p_show_id integer, p_inviter uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  s public.shared_shows;
begin
  update public.shared_shows set status = 'accepted'
  where show_id = p_show_id and inviter = p_inviter and invitee = me and status = 'pending'
  returning * into s;
  if not found then return; end if;

  insert into public.tracked_shows (user_id, show_id, name, image_url, status)
  values (me, p_show_id, s.show_name, s.image_url, 'watching'), (p_inviter, p_show_id, s.show_name, s.image_url, 'watching')
  on conflict (user_id, show_id) do nothing;
  update public.tracked_shows set status = 'watching'
  where show_id = p_show_id and user_id in (me, p_inviter) and status = 'later';
end;
$$;
revoke all on function public.accept_shared_show(integer, uuid) from public, anon;
grant execute on function public.accept_shared_show(integer, uuid) to authenticated;

-- Reporte chez le(s) partenaire(s) des épisodes que la personne connectée
-- vient de cocher (p_watched) ou de décocher : dans le revisionnage en cours
-- du partenaire s'il en a un, sinon dans son historique.
-- p_episodes : [{ "episode_id": 1, "season": 1, "number": 1, "watched_at": "…" }]
create or replace function public.sync_shared_episodes(p_show_id integer, p_episodes jsonb, p_watched boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  partner uuid;
  rewatching boolean;
begin
  for partner in select public.duo_partners(p_show_id) loop
    insert into public.tracked_shows (user_id, show_id, name, status)
    select partner, p_show_id, s.show_name, 'watching'
    from public.shared_shows s
    where s.show_id = p_show_id and s.status = 'accepted' and partner in (s.inviter, s.invitee)
    limit 1
    on conflict (user_id, show_id) do nothing;

    select t.rewatching into rewatching from public.tracked_shows t where t.user_id = partner and t.show_id = p_show_id;

    if rewatching then
      if p_watched then
        insert into public.rewatch_progress (user_id, show_id, episode_id, watched_at)
        select partner, p_show_id, (e->>'episode_id')::integer, nullif(e->>'watched_at', '')::timestamptz
        from jsonb_array_elements(p_episodes) e
        on conflict (user_id, episode_id) do nothing;
      else
        delete from public.rewatch_progress
        where user_id = partner and show_id = p_show_id
          and episode_id in (select (e->>'episode_id')::integer from jsonb_array_elements(p_episodes) e);
      end if;
      update public.tracked_shows
      set last_watched_at = coalesce(
        (select max(watched_at) from public.rewatch_progress r where r.user_id = partner and r.show_id = p_show_id),
        (select max(watched_at) from public.watched_episodes w where w.user_id = partner and w.show_id = p_show_id))
      where user_id = partner and show_id = p_show_id;
    else
      if p_watched then
        insert into public.watched_episodes (user_id, episode_id, show_id, season, number, watched_at)
        select partner, (e->>'episode_id')::integer, p_show_id, (e->>'season')::integer, (e->>'number')::integer,
               nullif(e->>'watched_at', '')::timestamptz
        from jsonb_array_elements(p_episodes) e
        on conflict (user_id, episode_id) do nothing;
        update public.tracked_shows set status = 'watching' where user_id = partner and show_id = p_show_id and status = 'later';
      else
        delete from public.watched_episodes
        where user_id = partner and show_id = p_show_id
          and episode_id in (select (e->>'episode_id')::integer from jsonb_array_elements(p_episodes) e);
      end if;
      update public.tracked_shows
      set last_watched_at = (select max(watched_at) from public.watched_episodes w where w.user_id = partner and w.show_id = p_show_id)
      where user_id = partner and show_id = p_show_id;
    end if;
  end loop;
end;
$$;
revoke all on function public.sync_shared_episodes(integer, jsonb, boolean) from public, anon;
grant execute on function public.sync_shared_episodes(integer, jsonb, boolean) to authenticated;

-- ========================================================= recommandations ==
-- Une série, un film ou un livre recommandé à un ami, avec un petit mot
-- facultatif. Le destinataire l'ajoute à sa liste ou le refuse : dans les
-- deux cas la recommandation disparaît (pas de modification possible, donc
-- pas d'expéditeur falsifiable).

create table if not exists public.recommendations (
  id bigint generated always as identity primary key,
  sender uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recipient uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('show', 'movie', 'book')),
  -- Identifiant du titre chez sa source : TVmaze, TMDB, ou « gb:… » / « ol:… ».
  item_id text not null,
  title text not null,
  image_url text,
  -- De quoi ajouter le titre à sa liste sans rien aller rechercher.
  meta jsonb not null default '{}'::jsonb,
  note text check (note is null or char_length(note) <= 280),
  created_at timestamptz not null default now(),
  unique (sender, recipient, kind, item_id),
  check (sender <> recipient)
);

alter table public.recommendations enable row level security;

drop policy if exists "recommendations: read" on public.recommendations;
create policy "recommendations: read" on public.recommendations
  for select to authenticated
  using ((select auth.uid()) in (sender, recipient));
-- Recommander seulement à un ami, en son nom.
drop policy if exists "recommendations: send" on public.recommendations;
create policy "recommendations: send" on public.recommendations
  for insert to authenticated
  with check ((select auth.uid()) = sender and public.is_my_friend(recipient));
drop policy if exists "recommendations: remove" on public.recommendations;
create policy "recommendations: remove" on public.recommendations
  for delete to authenticated
  using ((select auth.uid()) in (sender, recipient));

-- ------------------------------------------------------------------------
-- Revoir un film, relire un livre : les visionnages / lectures d'avant.
-- La ligne garde le plus récent ; les précédents sont empilés ici.
--   watched_movies.past_views : ["2024-05-03T12:00:00Z", null, …]  (null = date inconnue)
--   tracked_books.past_reads  : [{"started_at": …, "finished_at": …}, …]
alter table public.watched_movies add column if not exists past_views jsonb not null default '[]'::jsonb;
alter table public.tracked_books add column if not exists past_reads jsonb not null default '[]'::jsonb;

-- « Vu ensemble » : marque un film vu chez un ami, à la même date. Réservé
-- aux amis acceptés ; s'il l'avait déjà vu un autre jour, ce visionnage
-- s'ajoute aux siens au lieu de remplacer l'ancien.
create or replace function public.share_movie_viewing(
  p_friend uuid, p_movie_id integer, p_title text, p_poster text, p_year integer,
  p_release date, p_runtime integer, p_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cur public.watched_movies%rowtype;
begin
  if not public.is_my_friend(p_friend) then
    raise exception 'Pas amis';
  end if;
  select * into cur from public.watched_movies where user_id = p_friend and movie_id = p_movie_id;
  if not found then
    insert into public.watched_movies (user_id, movie_id, title, poster_url, release_year, release_date, runtime, watched_at, status)
    values (p_friend, p_movie_id, p_title, p_poster, p_year, p_release, p_runtime, p_at, 'watched');
  elsif cur.status <> 'watched' then
    update public.watched_movies set status = 'watched', watched_at = p_at
    where user_id = p_friend and movie_id = p_movie_id;
  elsif cur.watched_at is distinct from p_at
    and (cur.watched_at is null or p_at is null or cur.watched_at::date <> p_at::date) then
    update public.watched_movies
    set past_views = past_views || jsonb_build_array(cur.watched_at), watched_at = p_at
    where user_id = p_friend and movie_id = p_movie_id;
  end if;
end;
$$;

revoke all on function public.share_movie_viewing(uuid, integer, text, text, integer, date, integer, timestamptz) from public, anon;
grant execute on function public.share_movie_viewing(uuid, integer, text, text, integer, date, integer, timestamptz) to authenticated;

-- Revisionnages terminés d'une série, avec leurs dates : [{"started_at": …, "finished_at": …}].
-- `rewatches` reste le compte total (certains peuvent ne pas être datés).
alter table public.tracked_shows add column if not exists past_viewings jsonb not null default '[]'::jsonb;

-- « Vu ensemble » pour une série : coche chez un ami des épisodes que j'ai
-- vus, à mes dates (toute la série, une saison ou quelques épisodes). Réservé
-- aux amis acceptés, limité aux épisodes réellement cochés chez moi ; ceux
-- qu'il avait déjà gardent sa date. Pendant un revisionnage chez lui, ils
-- vont dans ce revisionnage. Renvoie le nombre d'épisodes ajoutés chez lui.
create or replace function public.share_show_episodes(
  p_friend uuid, p_show_id integer, p_name text, p_image text, p_episodes jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  is_rewatching boolean;
begin
  if not public.is_my_friend(p_friend) then
    raise exception 'Pas amis';
  end if;

  insert into public.tracked_shows (user_id, show_id, name, image_url, status)
  values (p_friend, p_show_id, p_name, p_image, 'watching')
  on conflict (user_id, show_id) do nothing;
  update public.tracked_shows set status = 'watching'
  where user_id = p_friend and show_id = p_show_id and status = 'later';

  select t.rewatching into is_rewatching from public.tracked_shows t where t.user_id = p_friend and t.show_id = p_show_id;

  with mine as (
    select (e->>'episode_id')::integer as episode_id, (e->>'season')::integer as season,
           (e->>'number')::integer as number, nullif(e->>'watched_at', '')::timestamptz as watched_at
    from jsonb_array_elements(p_episodes) e
    where exists (select 1 from public.watched_episodes w where w.user_id = auth.uid() and w.episode_id = (e->>'episode_id')::integer)
       or exists (select 1 from public.rewatch_progress r where r.user_id = auth.uid() and r.episode_id = (e->>'episode_id')::integer)
  ), ins_rw as (
    insert into public.rewatch_progress (user_id, show_id, episode_id, watched_at)
    select p_friend, p_show_id, episode_id, watched_at from mine where is_rewatching
    on conflict (user_id, episode_id) do nothing
    returning 1
  ), ins_h as (
    insert into public.watched_episodes (user_id, episode_id, show_id, season, number, watched_at)
    select p_friend, episode_id, p_show_id, season, number, watched_at from mine where not is_rewatching
    on conflict (user_id, episode_id) do nothing
    returning 1
  )
  select (select count(*) from ins_rw) + (select count(*) from ins_h) into n;

  update public.tracked_shows
  set last_watched_at = greatest(
    last_watched_at,
    (select max(watched_at) from public.watched_episodes w where w.user_id = p_friend and w.show_id = p_show_id),
    (select max(watched_at) from public.rewatch_progress r where r.user_id = p_friend and r.show_id = p_show_id))
  where user_id = p_friend and show_id = p_show_id;

  return n;
end;
$$;

revoke all on function public.share_show_episodes(uuid, integer, text, text, jsonb) from public, anon;
grant execute on function public.share_show_episodes(uuid, integer, text, text, jsonb) to authenticated;

-- ------------------------------------------------------------------------
-- Notifs de sortie des films « à voir » (tâche Netlify movie-releases).
-- movie_availability : dernières plateformes vues pour un film, pour ne
-- notifier que ce qui arrive (pas ce qui y était déjà au premier passage).
-- movie_notifications : ce qui a déjà été notifié à qui, pour ne pas répéter.
-- Écrites uniquement par la tâche (clé service_role, hors RLS).
create table if not exists public.movie_availability (
  movie_id integer primary key,
  providers text[] not null default '{}',
  checked_at timestamptz not null default now()
);
alter table public.movie_availability enable row level security;

create table if not exists public.movie_notifications (
  user_id uuid not null references auth.users (id) on delete cascade,
  movie_id integer not null,
  kind text not null,              -- 'cinema' ou 'stream:<plateforme>'
  created_at timestamptz not null default now(),
  primary key (user_id, movie_id, kind)
);
alter table public.movie_notifications enable row level security;
