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

drop policy if exists "watched_movies: own rows" on public.watched_movies;
create policy "watched_movies: own rows" on public.watched_movies
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
