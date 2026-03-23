-- snakee.io v1 auth + profile + stats schema
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 18),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.player_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  games_played integer not null default 0 check (games_played >= 0),
  total_score bigint not null default 0 check (total_score >= 0),
  best_score integer not null default 0 check (best_score >= 0),
  best_length integer not null default 0 check (best_length >= 0),
  last_played_at timestamptz
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_name text;
  safe_name text;
begin
  raw_name := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'Player');
  safe_name := left(trim(regexp_replace(raw_name, '\s+', ' ', 'g')), 18);
  if safe_name is null or char_length(safe_name) = 0 then
    safe_name := 'Player';
  end if;

  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, safe_name, new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;

  insert into public.player_stats (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.player_stats enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "stats_select_own" on public.player_stats;
create policy "stats_select_own" on public.player_stats
for select using (auth.uid() = user_id);

drop policy if exists "stats_update_own" on public.player_stats;
create policy "stats_update_own" on public.player_stats
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "leaderboard_public_read" on public.player_stats;
create policy "leaderboard_public_read" on public.player_stats
for select using (true);
