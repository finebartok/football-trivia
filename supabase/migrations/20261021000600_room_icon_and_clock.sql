-- A crafted vibe keeps its icon, the room tells the client what time it is,
-- and a refusal is a refusal rather than a server fault.
--
-- A phone whose clock has drifted must see the clues at the same moment as
-- everybody else, so the server's clock travels with the state and the
-- client measures itself against it.
--
-- P0002 is a plpgsql error code and PostgREST turns it into a 500. A
-- player who typed the wrong code is a bad request, not an outage, and the
-- logs should say so.

alter table public.rooms add column if not exists scope_icon text;

drop function if exists public.create_room(text, jsonb, text, text);

create or replace function public.create_room(
  p_scope_id text,
  p_scope_clauses jsonb,
  p_display_name text,
  p_scope_name text default null,
  p_scope_icon text default null
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
      insert into public.rooms (code, creator_id, scope_id, scope_clauses, scope_name, scope_icon)
      values (
        v_code, auth.uid(), p_scope_id, coalesce(p_scope_clauses, '[]'::jsonb),
        left(coalesce(p_scope_name, ''), 60),
        left(coalesce(p_scope_icon, ''), 8)
      )
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

-- The refusals a player can cause are bad requests.
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
    raise exception 'no room has that code' using errcode = '22023';
  end if;

  if v_room.status <> 'lobby' then
    raise exception 'that game has already started' using errcode = '22023';
  end if;

  v_name := public.clean_display_name(p_display_name);

  select count(*) into v_count
  from public.room_memberships
  where room_id = v_room.id;

  if v_count >= v_room.max_players then
    raise exception 'that room is full' using errcode = '22023';
  end if;

  -- The lock keeps two players joining at the same moment from taking
  -- the same join order, and from both squeezing past the cap.
  perform 1 from public.rooms where id = v_room.id for no key update;

  select count(*) into v_count
  from public.room_memberships
  where room_id = v_room.id;

  if v_count >= v_room.max_players then
    raise exception 'that room is full' using errcode = '22023';
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

-- The state carries the vibe's icon and the server's clock.
create or replace function public.sync_room_state(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state jsonb;
  v_answered_round int;
  v_mine jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_state := public.current_round(p_room_id);

  -- The player's own last answer, so a player who reloads comes back
  -- knowing what they answered and what it was worth.
  select max(r.round_number) into v_answered_round
  from public.answers a
  join public.rounds r on r.id = a.round_id
  where a.room_id = p_room_id and a.user_id = auth.uid();

  -- The same shape the submit-answer function returns, so the client
  -- does not have to know which one it is looking at.
  select jsonb_build_object(
      'correct', a.is_correct,
      'points', a.points_earned,
      'stage', a.stage_locked,
      'guessed_answer', a.guessed_answer
    ) into v_mine
  from public.answers a
  join public.rounds r on r.id = a.round_id
  where a.room_id = p_room_id and a.user_id = auth.uid()
    and r.round_number = v_answered_round;

  return v_state || jsonb_build_object(
    'my_answered_round', v_answered_round,
    'my_answer', v_mine,
    'scope_icon', (select r.scope_icon from public.rooms r where r.id = p_room_id),
    'server_now', now(),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'display_name', m.display_name,
        'is_host', m.is_host,
        'joined_seq', m.joined_seq,
        'online', m.last_seen_at > now() - interval '30 seconds'
      ) order by m.joined_seq)
      from public.room_memberships m
      where m.room_id = p_room_id
    ), '[]'::jsonb),
    'leaderboard', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'display_name', m.display_name,
        'total_score', m.total_score,
        'correct_count', m.correct_count,
        'total_response_ms', m.total_response_ms,
        'joined_seq', m.joined_seq
      ) order by m.total_score desc, m.correct_count desc,
               m.total_response_ms asc, m.joined_seq asc)
      from public.room_memberships m
      where m.room_id = p_room_id
    ), '[]'::jsonb)
  );
end;
$$;
