-- Run this in Supabase SQL editor.
--
-- This schema is designed for a static frontend (anon key):
-- - Public read (anyone with the link can view group dashboard)
-- - Password-gated writes via RPCs (no Supabase Auth required)

-- In Supabase, extension functions often live in the `extensions` schema.
create extension if not exists pgcrypto with schema extensions;

-- -----------------------
-- Tables
-- -----------------------

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

-- Group code (user-chosen, URL friendly). Nullable for existing rows; unique when set.
alter table public.groups
add column if not exists code text;

-- Only allow lowercase letters + numbers, 3-32 chars (if code is set).
alter table public.groups
drop constraint if exists groups_code_format;
alter table public.groups
add constraint groups_code_format
check (code is null or code ~ '^[a-z0-9]{3,32}$');

create unique index if not exists groups_code_unique_idx
on public.groups (code)
where code is not null;

-- Migration: ensure password_hash exists even if groups was created earlier.
alter table public.groups
add column if not exists password_hash text;

-- If any existing rows are missing a password hash, lock them with a random one.
-- (They'll be readable, but not editable unless you later implement a reset flow.)
update public.groups
set password_hash = extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf'))
where password_hash is null;

alter table public.groups
alter column password_hash set not null;

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.nights (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  played_on date not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.night_results (
  night_id uuid not null references public.nights(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  buy_in_cents int not null default 0 check (buy_in_cents >= 0),
  cash_out_cents int not null default 0 check (cash_out_cents >= 0),
  primary key (night_id, player_id)
);

create table if not exists public.group_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create unique index if not exists group_sessions_token_hash_unique_idx
on public.group_sessions (token_hash);

create index if not exists group_sessions_group_id_idx
on public.group_sessions (group_id);

create index if not exists group_sessions_expires_at_idx
on public.group_sessions (expires_at);

create index if not exists players_group_id_idx on public.players(group_id);
create index if not exists nights_group_id_idx on public.nights(group_id);
create index if not exists night_results_player_id_idx on public.night_results(player_id);

-- -----------------------
-- RLS policies (read-only for anon)
-- -----------------------

alter table public.groups enable row level security;
alter table public.players enable row level security;
alter table public.nights enable row level security;
alter table public.night_results enable row level security;
alter table public.group_sessions enable row level security;

drop policy if exists "groups_select" on public.groups;
create policy "groups_select" on public.groups
for select to anon
using (true);

drop policy if exists "players_select" on public.players;
create policy "players_select" on public.players
for select to anon
using (true);

drop policy if exists "nights_select" on public.nights;
create policy "nights_select" on public.nights
for select to anon
using (true);

drop policy if exists "night_results_select" on public.night_results;
create policy "night_results_select" on public.night_results
for select to anon
using (true);

-- Prevent direct writes from anon; all writes happen through RPCs.
revoke insert, update, delete on table public.groups from anon, authenticated;
revoke insert, update, delete on table public.players from anon, authenticated;
revoke insert, update, delete on table public.nights from anon, authenticated;
revoke insert, update, delete on table public.night_results from anon, authenticated;
revoke select, insert, update, delete on table public.group_sessions from anon, authenticated;

-- -----------------------
-- Helper: password check
-- -----------------------

create or replace function public.assert_group_password(p_group_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  select password_hash into v_hash
  from public.groups
  where id = p_group_id;

  if v_hash is null then
    raise exception 'Group not found';
  end if;

  if p_password is null or length(p_password) < 4 then
    raise exception 'Password required';
  end if;

  if extensions.crypt(p_password, v_hash) <> v_hash then
    raise exception 'Invalid password';
  end if;
end;
$$;

grant execute on function public.assert_group_password(uuid, text) to anon, authenticated;

create or replace function public.assert_group_session(
  p_group_id uuid,
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  if p_session_token is null or length(p_session_token) < 20 then
    raise exception 'Session required';
  end if;

  select token_hash into v_hash
  from public.group_sessions
  where group_id = p_group_id
    and expires_at > now()
    and extensions.crypt(p_session_token, token_hash) = token_hash
  limit 1;

  if v_hash is null then
    raise exception 'Session expired';
  end if;
end;
$$;

grant execute on function public.assert_group_session(uuid, text) to anon, authenticated;

-- -----------------------
-- RPCs (writes)
-- -----------------------

create or replace function public.create_group(
  group_name text,
  group_code text,
  group_password text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if group_name is null or length(trim(group_name)) = 0 then
    raise exception 'Group name is required';
  end if;
  if group_code is null or length(trim(group_code)) = 0 then
    raise exception 'Group code is required';
  end if;
  group_code := lower(trim(group_code));
  if group_code !~ '^[a-z0-9]{3,32}$' then
    raise exception 'Group code must be 3-32 chars: lowercase letters and numbers only';
  end if;
  if group_password is null or length(group_password) < 4 then
    raise exception 'Group password must be at least 4 characters';
  end if;

  insert into public.groups (name, code, password_hash)
  values (
    trim(group_name),
    group_code,
    extensions.crypt(group_password, extensions.gen_salt('bf'))
  )
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function public.create_group(text, text, text) to anon, authenticated;

create or replace function public.create_group_session(
  p_group_code text,
  p_password text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_token text;
  v_hash text;
begin
  if p_group_code is null or length(trim(p_group_code)) = 0 then
    raise exception 'Group code is required';
  end if;
  p_group_code := lower(trim(p_group_code));

  select id into v_group_id
  from public.groups
  where code = p_group_code;

  if v_group_id is null then
    raise exception 'Group not found';
  end if;

  perform public.assert_group_password(v_group_id, p_password);

  v_token := gen_random_uuid()::text || gen_random_uuid()::text;
  v_hash := extensions.crypt(v_token, extensions.gen_salt('bf'));

  insert into public.group_sessions (group_id, token_hash, expires_at)
  values (v_group_id, v_hash, now() + interval '12 hours');

  return v_token;
end;
$$;

grant execute on function public.create_group_session(text, text) to anon, authenticated;

create or replace function public.create_player(p_group_id uuid, p_session_token text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  perform public.assert_group_session(p_group_id, p_session_token);

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Player name is required';
  end if;

  insert into public.players (group_id, name)
  values (p_group_id, trim(p_name))
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function public.create_player(uuid, text, text) to anon, authenticated;

create or replace function public.rename_player(
  p_group_id uuid,
  p_session_token text,
  p_player_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_group_session(p_group_id, p_session_token);

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Player name is required';
  end if;

  update public.players
  set name = trim(p_name)
  where id = p_player_id
    and group_id = p_group_id;

  if not found then
    raise exception 'Player not found';
  end if;
end;
$$;

grant execute on function public.rename_player(uuid, text, uuid, text) to anon, authenticated;

create or replace function public.create_night(
  p_group_id uuid,
  p_session_token text,
  p_played_on date,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  perform public.assert_group_session(p_group_id, p_session_token);

  if p_played_on is null then
    raise exception 'Date required';
  end if;

  insert into public.nights (group_id, played_on, notes)
  values (p_group_id, p_played_on, p_notes)
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function public.create_night(uuid, text, date, text) to anon, authenticated;

-- p_results is a JSON array of objects like:
-- [{ "player_id": "<uuid>", "buy_in_cents": 2000, "cash_out_cents": 3500 }, ...]
create or replace function public.upsert_night_results(
  p_group_id uuid,
  p_session_token text,
  p_night_id uuid,
  p_results jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_player_id uuid;
  v_buy_in int;
  v_cash_out int;
  v_night_group uuid;
begin
  perform public.assert_group_session(p_group_id, p_session_token);

  select group_id into v_night_group
  from public.nights
  where id = p_night_id;

  if v_night_group is null then
    raise exception 'Night not found';
  end if;
  if v_night_group <> p_group_id then
    raise exception 'Night does not belong to group';
  end if;

  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    raise exception 'Results must be a JSON array';
  end if;

  for v_item in select * from jsonb_array_elements(p_results)
  loop
    v_player_id := (v_item->>'player_id')::uuid;
    v_buy_in := coalesce((v_item->>'buy_in_cents')::int, 0);
    v_cash_out := coalesce((v_item->>'cash_out_cents')::int, 0);

    if v_buy_in < 0 or v_cash_out < 0 then
      raise exception 'Amounts must be non-negative';
    end if;

    -- Ensure player is part of the group.
    if not exists (
      select 1 from public.players
      where id = v_player_id and group_id = p_group_id
    ) then
      raise exception 'Player does not belong to group';
    end if;

    insert into public.night_results (night_id, player_id, buy_in_cents, cash_out_cents)
    values (p_night_id, v_player_id, v_buy_in, v_cash_out)
    on conflict (night_id, player_id) do update
    set buy_in_cents = excluded.buy_in_cents,
        cash_out_cents = excluded.cash_out_cents;
  end loop;
end;
$$;

grant execute on function public.upsert_night_results(uuid, text, uuid, jsonb) to anon, authenticated;
