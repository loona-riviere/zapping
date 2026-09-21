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

-- Avance last_watched_at sans jamais le faire reculer : corriger la date
-- d'un vieil épisode ne doit pas faire passer la série pour « pas revue
-- depuis » alors qu'un épisode plus récent est déjà enregistré ailleurs.
-- security invoker : s'exécute avec les droits de l'appelant, RLS comprise.
create or replace function public.bump_last_watched(p_show_id integer, p_at timestamptz)
returns void
language sql
security invoker
as $$
  update public.tracked_shows
  set last_watched_at = greatest(coalesce(last_watched_at, p_at), p_at)
  where show_id = p_show_id and user_id = auth.uid();
$$;

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
