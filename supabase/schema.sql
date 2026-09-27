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
