-- Run once in a dedicated Supabase project's SQL Editor.
-- Stores Copy signatures, interface mappings and their history.
-- Does not store router commands or passwords.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.g06_rooms (
  id uuid primary key default gen_random_uuid(),
  join_key_hash text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.g06_room_members (
  room_id uuid not null references public.g06_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (room_id, user_id)
);
create table if not exists public.g06_copy_progress (
  room_id uuid not null references public.g06_rooms(id) on delete cascade,
  block_key text not null check (length(block_key) <= 280 and block_key ~ '^(hsrp|vrrp):(CE01|CE02|MLS01|MLS02|R01|SW01):.{1,255}$'),
  signature text check (signature is null or signature ~ '^[0-9]{1,6}:[0-9a-f]{1,8}$'),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (room_id, block_key)
);
alter table public.g06_rooms enable row level security;
alter table public.g06_room_members enable row level security;
alter table public.g06_copy_progress enable row level security;
revoke all on public.g06_rooms, public.g06_room_members, public.g06_copy_progress from anon, authenticated;
grant select on public.g06_room_members to authenticated;
grant select, insert, update on public.g06_copy_progress to authenticated;

drop policy if exists g06_member_self on public.g06_room_members;
create policy g06_member_self on public.g06_room_members for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists g06_progress_read on public.g06_copy_progress;
create policy g06_progress_read on public.g06_copy_progress for select to authenticated
  using (exists (select 1 from public.g06_room_members m where m.room_id = g06_copy_progress.room_id and m.user_id = (select auth.uid())));
drop policy if exists g06_progress_insert on public.g06_copy_progress;
create policy g06_progress_insert on public.g06_copy_progress for insert to authenticated
  with check (updated_by = (select auth.uid()) and exists (select 1 from public.g06_room_members m where m.room_id = g06_copy_progress.room_id and m.user_id = (select auth.uid())));
drop policy if exists g06_progress_update on public.g06_copy_progress;
create policy g06_progress_update on public.g06_copy_progress for update to authenticated
  using (exists (select 1 from public.g06_room_members m where m.room_id = g06_copy_progress.room_id and m.user_id = (select auth.uid())))
  with check (updated_by = (select auth.uid()) and exists (select 1 from public.g06_room_members m where m.room_id = g06_copy_progress.room_id and m.user_id = (select auth.uid())));

create or replace function public.g06_create_room() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_key text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  insert into public.g06_rooms (join_key_hash, created_by)
    values (encode(extensions.digest(v_key, 'sha256'), 'hex'), v_uid) returning id into v_id;
  insert into public.g06_room_members (room_id, user_id) values (v_id, v_uid);
  return jsonb_build_object('room_id', v_id, 'join_key', v_key);
end;
$$;
create or replace function public.g06_join_room(p_room_id uuid, p_join_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if p_join_key is null or length(p_join_key) <> 64 or not exists (
    select 1 from public.g06_rooms where id = p_room_id and join_key_hash = encode(extensions.digest(p_join_key, 'sha256'), 'hex')
  ) then raise exception 'Room link is invalid'; end if;
  insert into public.g06_room_members (room_id, user_id) values (p_room_id, v_uid) on conflict do nothing;
end;
$$;
revoke all on function public.g06_create_room(), public.g06_join_room(uuid, text) from public, anon;
grant execute on function public.g06_create_room(), public.g06_join_room(uuid, text) to authenticated;

create or replace function public.g06_stamp_progress() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists g06_progress_stamp on public.g06_copy_progress;
create trigger g06_progress_stamp before insert or update on public.g06_copy_progress
  for each row execute function public.g06_stamp_progress();

create table if not exists public.g06_interface_ports (
  room_id uuid not null references public.g06_rooms(id) on delete cascade,
  set_id text not null check (set_id in ('hsrp','vrrp')),
  device_id text not null check (device_id in ('CE01','CE02','MLS01','MLS02','R01','SW01')),
  original text not null,
  replacement text not null,
  primary key (room_id, set_id, device_id, original)
);
-- RPC validates final destinations after updating the complete range.
-- This allows restoring swapped ports atomically.
drop index if exists public.g06_interface_destination;
create table if not exists public.g06_interface_history (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.g06_rooms(id) on delete cascade,
  set_id text not null,
  device_id text not null,
  changes jsonb not null,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now()
);
alter table public.g06_interface_ports enable row level security;
alter table public.g06_interface_history enable row level security;
revoke all on public.g06_interface_ports, public.g06_interface_history from anon, authenticated;
grant select on public.g06_interface_ports, public.g06_interface_history to authenticated;
drop policy if exists g06_ports_read on public.g06_interface_ports;
create policy g06_ports_read on public.g06_interface_ports for select to authenticated
  using (exists (select 1 from public.g06_room_members m where m.room_id = g06_interface_ports.room_id and m.user_id = (select auth.uid())));
drop policy if exists g06_history_read on public.g06_interface_history;
create policy g06_history_read on public.g06_interface_history for select to authenticated
  using (exists (select 1 from public.g06_room_members m where m.room_id = g06_interface_history.room_id and m.user_id = (select auth.uid())));

create or replace function public.g06_set_interfaces(p_room_id uuid, p_set_id text, p_device_id text, p_originals text[], p_replacements text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_before text;
  v_changes jsonb := '[]'::jsonb;
  v_pattern text := '^(GigabitEthernet|FastEthernet|TenGigabitEthernet|Ethernet|Serial)[0-9]+(/[0-9]+){0,3}$';
  i integer;
begin
  if v_uid is null or not exists (select 1 from public.g06_room_members where room_id = p_room_id and user_id = v_uid) then
    raise exception 'Room membership required';
  end if;
  if p_set_id is null or p_set_id not in ('hsrp','vrrp') or p_device_id is null or p_device_id not in ('CE01','CE02','MLS01','MLS02','R01','SW01')
    or p_originals is null or p_replacements is null or cardinality(p_originals) not between 1 and 48
    or cardinality(p_originals) <> cardinality(p_replacements)
    or (select count(distinct x) from unnest(p_originals) x) <> cardinality(p_originals) then
    raise exception 'Invalid interface change';
  end if;
  -- Serialize room edits so the history records the actual previous value.
  perform id from public.g06_rooms where id = p_room_id for update;
  for i in 1..cardinality(p_originals) loop
    if p_originals[i] is null or p_replacements[i] is null or length(p_originals[i]) > 100 or length(p_replacements[i]) > 100
      or not (p_originals[i] ~ v_pattern or p_originals[i] = '<WAN_PORT>')
      or not (p_replacements[i] ~ v_pattern or p_replacements[i] = p_originals[i]) then
      raise exception 'Invalid interface name';
    end if;
    select replacement into v_before from public.g06_interface_ports
      where room_id = p_room_id and set_id = p_set_id and device_id = p_device_id and original = p_originals[i];
    v_before := coalesce(v_before, p_originals[i]);
    if v_before <> p_replacements[i] then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('original', p_originals[i], 'from', v_before, 'to', p_replacements[i]));
    end if;
    insert into public.g06_interface_ports (room_id, set_id, device_id, original, replacement)
      values (p_room_id, p_set_id, p_device_id, p_originals[i], p_replacements[i])
      on conflict (room_id, set_id, device_id, original) do update set replacement = excluded.replacement;
  end loop;
  if exists (select replacement from public.g06_interface_ports
    where room_id = p_room_id and set_id = p_set_id and device_id = p_device_id and not (p_device_id = 'R01' and original = '<WAN_PORT>')
    group by replacement having count(*) > 1) then
    raise exception 'Destination port is already in use';
  end if;
  if jsonb_array_length(v_changes) > 0 then
    insert into public.g06_interface_history (room_id, set_id, device_id, changes, changed_by)
      values (p_room_id, p_set_id, p_device_id, v_changes, v_uid);
  end if;
end;
$$;
revoke all on function public.g06_set_interfaces(uuid, text, text, text[], text[]) from public, anon;
grant execute on function public.g06_set_interfaces(uuid, text, text, text[], text[]) to authenticated;
-- Reset is an UPDATE with signature = NULL, so Realtime can check membership.
-- Direct DELETE is intentionally not granted to browser clients.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'g06_copy_progress') then
    alter publication supabase_realtime add table public.g06_copy_progress;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'g06_interface_history') then
    alter publication supabase_realtime add table public.g06_interface_history;
  end if;
end;
$$;
commit;
