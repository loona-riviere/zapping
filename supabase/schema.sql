-- Zapping : schéma Supabase
-- À exécuter une fois dans l'éditeur SQL de ton projet Supabase.

create table if not exists public.tracked_shows (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  show_id integer not null,            -- identifiant TVmaze
  name text not null,
  image_url text,
  added_at timestamptz not null default now(),
  last_watched_at timestamptz,
  primary key (user_id, show_id)
);

create table if not exists public.watched_episodes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  episode_id integer not null,         -- identifiant TVmaze
  show_id integer not null,
  season integer not null,
  number integer not null,
  watched_at timestamptz not null default now(),
  primary key (user_id, episode_id)
);

create index if not exists watched_episodes_user_show_idx
  on public.watched_episodes (user_id, show_id);

alter table public.tracked_shows enable row level security;
alter table public.watched_episodes enable row level security;

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
