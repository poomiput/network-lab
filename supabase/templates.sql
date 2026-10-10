-- Add named, shared Templates to the existing G06 database. Run once in SQL Editor.
-- Existing rooms, Copy marks, interfaces and history are retained.
begin;
alter table public.g06_rooms add column if not exists template_name text;
alter table public.g06_rooms add column if not exists is_template boolean not null default false;
create unique index if not exists g06_template_name on public.g06_rooms (lower(template_name)) where is_template;

create or replace function public.g06_list_templates()
returns table (id uuid, name text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return query select r.id, r.template_name, r.created_at from public.g06_rooms r
    where r.is_template order by lower(r.template_name), r.id;
end;
$$;

create or replace function public.g06_create_template(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(p_name);
  v_id uuid;
  v_key text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if v_name is null or length(v_name) not between 1 and 80 or v_name ~ '[[:cntrl:]]' then
    raise exception 'ชื่อ Template ต้องมี 1-80 ตัวอักษร';
  end if;
  begin
    insert into public.g06_rooms (join_key_hash, created_by, template_name, is_template)
      values (encode(extensions.digest(v_key, 'sha256'), 'hex'), v_uid, v_name, true) returning id into v_id;
  exception when unique_violation then
    raise exception 'ชื่อนี้มีแล้ว กรุณาเลือก Template จากรายการ';
  end;
  insert into public.g06_room_members (room_id, user_id) values (v_id, v_uid);
  return jsonb_build_object('id', v_id, 'name', v_name);
end;
$$;

create or replace function public.g06_open_template(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  select template_name into v_name from public.g06_rooms where id = p_id and is_template;
  if v_name is null then raise exception 'ไม่พบ Template นี้'; end if;
  insert into public.g06_room_members (room_id, user_id) values (p_id, v_uid) on conflict do nothing;
  return jsonb_build_object('id', p_id, 'name', v_name);
end;
$$;
revoke all on function public.g06_list_templates(), public.g06_create_template(text), public.g06_open_template(uuid) from public, anon;
grant execute on function public.g06_list_templates(), public.g06_create_template(text), public.g06_open_template(uuid) to authenticated;
commit;
