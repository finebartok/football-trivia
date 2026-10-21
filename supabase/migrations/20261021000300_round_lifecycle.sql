-- The round lifecycle.
--
-- The server is the clock. A round closes when its deadline passes or
-- when every member has answered, and the next round is materialised at
-- that moment - so a future round has no row until the one before it
-- closes, and a client that queries the table directly finds nothing to
-- read ahead.

create or replace function public.advance_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_next jsonb;
  v_started timestamptz;
  v_next_round public.rounds;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'not a member of that room' using errcode = '42501';
  end if;

  select * into v_room from public.rooms where id = p_room_id for update;
  if v_room.id is null or v_room.status <> 'round_active' then
    return;
  end if;

  select * into v_round
  from public.rounds
  where room_id = p_room_id and round_number = v_room.current_round;
  if v_round.id is null then
    return;
  end if;

  -- Still time, and somebody has not answered: the round goes on.
  if now() <= v_round.deadline_at and exists (
    select 1 from public.room_memberships m
    where m.room_id = p_room_id
      and not exists (
        select 1 from public.answers a
        where a.round_id = v_round.id and a.user_id = m.user_id
      )
  ) then
    return;
  end if;

  update public.rounds set closed_at = now() where id = v_round.id;

  -- The scores become visible when the round closes, not when they are
  -- earned. Nobody learns anything from anybody else's play mid-round.
  update public.room_memberships m
  set total_score = m.total_score + coalesce(t.points, 0),
      correct_count = m.correct_count + coalesce(t.corrects, 0),
      total_response_ms = m.total_response_ms + coalesce(t.elapsed, 0)
  from (
    select user_id,
           sum(points_earned) as points,
           sum(case when is_correct then 1 else 0 end) as corrects,
           sum(response_time_ms) as elapsed
    from public.answers
    where round_id = v_round.id
    group by user_id
  ) t
  where m.room_id = p_room_id and m.user_id = t.user_id;

  -- A host who has gone quiet does not hold the room hostage. The role
  -- moves to the longest-tenured player who is still here, and the old
  -- host gives it up - there is exactly one host.
  if not exists (
    select 1 from public.room_memberships
    where room_id = p_room_id and is_host and last_seen_at > now() - interval '30 seconds'
  ) then
    update public.room_memberships
    set is_host = false
    where room_id = p_room_id and is_host;

    update public.room_memberships m
    set is_host = true
    where m.id = (
      select id from public.room_memberships
      where room_id = p_room_id
        and last_seen_at > now() - interval '30 seconds'
      order by joined_seq
      limit 1
    );
  end if;

  if v_room.current_round >= v_room.total_rounds then
    update public.rooms set status = 'final', finished_at = now() where id = p_room_id;
    return;
  end if;

  select e into v_next
  from public.quiz_plans q, jsonb_array_elements(q.plan) e
  where q.room_id = p_room_id
    and (e->'client'->>'round_number')::int = v_room.current_round + 1;

  if v_next is null then
    update public.rooms set status = 'abandoned' where id = p_room_id;
    return;
  end if;

  v_started := now();

  insert into public.rounds (
    room_id, round_number, template, prompt, context,
    clues, options, reveal_schedule, started_at, deadline_at
  )
  values (
    p_room_id,
    (v_next->'client'->>'round_number')::int,
    v_next->'client'->>'template',
    v_next->'client'->>'prompt',
    v_next->'client'->>'context',
    v_next->'client'->'clues',
    v_next->'client'->'options',
    v_next->'client'->'reveal_schedule',
    v_started,
    v_started + interval '20 seconds'
  )
  returning * into v_next_round;

  insert into public.round_secrets (round_id, answer_value, target_player_id, unit)
  values (
    v_next_round.id,
    v_next->'secret'->>'answer_value',
    nullif(v_next->'secret'->>'target_player_id', '')::bigint,
    nullif(v_next->'secret'->>'unit', '')
  );

  update public.rooms
  set current_round = current_round + 1, status = 'round_active'
  where id = p_room_id;
end;
$$;

create or replace function public.current_round(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'not a member of that room' using errcode = '42501';
  end if;

  -- The poll is the heartbeat, so liveness costs no extra traffic.
  update public.room_memberships
  set last_seen_at = now()
  where room_id = p_room_id and user_id = auth.uid();

  perform public.advance_room(p_room_id);

  select * into v_room from public.rooms where id = p_room_id;

  select * into v_round
  from public.rounds
  where room_id = p_room_id and round_number = v_room.current_round;

  return jsonb_build_object(
    'status', v_room.status,
    'current_round', v_room.current_round,
    'total_rounds', v_room.total_rounds,
    'scope_id', v_room.scope_id,
    'round', case when v_round.id is null then null else jsonb_build_object(
      'id', v_round.id,
      'round_number', v_round.round_number,
      'template', v_round.template,
      'prompt', v_round.prompt,
      'context', v_round.context,
      'clues', v_round.clues,
      'options', v_round.options,
      'reveal_schedule', v_round.reveal_schedule,
      'started_at', v_round.started_at,
      'deadline_at', v_round.deadline_at
    ) end
  );
end;
$$;

create or replace function public.round_result(p_room_id uuid, p_round_number int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.rounds;
  v_secret public.round_secrets;
  v_leaderboard jsonb;
  v_mine jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'not a member of that room' using errcode = '42501';
  end if;

  select * into v_round
  from public.rounds
  where room_id = p_room_id and round_number = p_round_number;
  if v_round.id is null then
    raise exception 'no such round' using errcode = 'P0002';
  end if;

  if v_round.closed_at is null and now() <= v_round.deadline_at then
    raise exception 'that round is still open' using errcode = 'P0002';
  end if;

  select * into v_secret from public.round_secrets where round_id = v_round.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', m.user_id,
      'display_name', m.display_name,
      'is_host', m.is_host,
      'total_score', m.total_score,
      'correct_count', m.correct_count,
      'total_response_ms', m.total_response_ms,
      'joined_seq', m.joined_seq
    ) order by m.total_score desc, m.correct_count desc,
             m.total_response_ms asc, m.joined_seq asc), '[]'::jsonb)
  into v_leaderboard
  from public.room_memberships m
  where m.room_id = p_room_id;

  select to_jsonb(a) - 'id' - 'room_id' - 'round_id' - 'user_id' into v_mine
  from public.answers a
  where a.round_id = v_round.id and a.user_id = auth.uid();

  return jsonb_build_object(
    'round_number', p_round_number,
    'answer', v_secret.answer_value,
    'unit', v_secret.unit,
    'target_player_id', v_secret.target_player_id,
    'leaderboard', v_leaderboard,
    'my_answer', v_mine
  );
end;
$$;

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
