-- The room lifecycle a player drives directly.

-- A display name is untrusted input from another device: it is trimmed,
-- stripped of anything unprintable, and capped.
create or replace function public.clean_display_name(p_name text)
returns text
language sql
immutable
as $$
  select left(
    case
      when btrim(regexp_replace(coalesce(p_name, ''), '[^[:print:]]', '', 'g')) = ''
        then 'Player'
      else btrim(regexp_replace(coalesce(p_name, ''), '[^[:print:]]', '', 'g'))
    end,
    24);
$$;

create or replace function public.create_room(
  p_scope_id text,
  p_scope_clauses jsonb,
  p_display_name text
) returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_name text;
  i int;
  j int;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_name := public.clean_display_name(p_display_name);

  -- The code is an invitation, not a secret, but it still should not be
  -- guessable in a handful of tries: 32 characters, six of them.
  for i in 1 .. 20 loop
    v_code := '';
    for j in 1 .. 6 loop
      v_code := v_code || substr(
        'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
        1 + floor(random() * 32)::int,
        1);
    end loop;
    begin
      insert into public.rooms (code, creator_id, scope_id, scope_clauses)
      values (v_code, auth.uid(), p_scope_id, coalesce(p_scope_clauses, '[]'::jsonb))
      returning * into v_room;
      exit;
    exception when unique_violation then
      continue;
    end;
  end loop;

  if v_room.id is null then
    raise exception 'could not allocate a room code' using errcode = 'P0001';
  end if;

  insert into public.room_memberships (room_id, user_id, display_name, is_host, joined_seq)
  values (v_room.id, auth.uid(), v_name, true, 1);

  return v_room;
end;
$$;

create or replace function public.join_room(p_code text, p_display_name text)
returns public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_name text;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into v_room
  from public.rooms
  where upper(code) = upper(btrim(coalesce(p_code, '')));

  if v_room.id is null then
    raise exception 'no room has that code' using errcode = 'P0002';
  end if;

  if v_room.status <> 'lobby' then
    raise exception 'that game has already started' using errcode = 'P0002';
  end if;

  v_name := public.clean_display_name(p_display_name);

  select count(*) into v_count
  from public.room_memberships
  where room_id = v_room.id;

  if v_count >= v_room.max_players then
    raise exception 'that room is full' using errcode = 'P0002';
  end if;

  insert into public.room_memberships (room_id, user_id, display_name, joined_seq)
  values (
    v_room.id,
    auth.uid(),
    v_name,
    coalesce((select max(joined_seq) from public.room_memberships where room_id = v_room.id), 0) + 1
  )
  on conflict (room_id, user_id)
  do update set display_name = excluded.display_name;

  return v_room;
end;
$$;

create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_host boolean;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select is_host into v_was_host
  from public.room_memberships
  where room_id = p_room_id and user_id = auth.uid();

  delete from public.room_memberships
  where room_id = p_room_id and user_id = auth.uid();

  if v_was_host then
    update public.room_memberships m
    set is_host = true
    where m.id = (
      select id from public.room_memberships
      where room_id = p_room_id
      order by joined_seq
      limit 1
    );
  end if;
end;
$$;

-- A room's size, for tests and for a future "private room" setting.
create or replace function public.set_room_capacity(p_room_id uuid, p_max_players int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.rooms where id = p_room_id and creator_id = auth.uid()
  ) then
    raise exception 'only the host may resize a room' using errcode = '42501';
  end if;

  update public.rooms
  set max_players = least(greatest(p_max_players, 2), 12)
  where id = p_room_id;
end;
$$;
