-- A room announces the vibe it is playing. A crafted vibe has no preset
-- id to look the name up from, so the room keeps the name it was given.

alter table public.rooms add column if not exists scope_name text;

drop function if exists public.create_room(text, jsonb, text);

create or replace function public.create_room(
  p_scope_id text,
  p_scope_clauses jsonb,
  p_display_name text,
  p_scope_name text default null
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
      insert into public.rooms (code, creator_id, scope_id, scope_clauses, scope_name)
      values (v_code, auth.uid(), p_scope_id, coalesce(p_scope_clauses, '[]'::jsonb), left(coalesce(p_scope_name, ''), 60))
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
