-- Football IQ mode: the room's mode, the reveal payload, and the six-argument
-- create_room. Guess-the-player stays the default.

alter table public.rooms add column if not exists game_mode text;
update public.rooms set game_mode = 'guess_player' where game_mode is null;
alter table public.rooms alter column game_mode set default 'guess_player';
alter table public.rooms alter column game_mode set not null;

alter table public.rooms drop constraint if exists rooms_game_mode_check;
alter table public.rooms add constraint rooms_game_mode_check
  check (game_mode in ('guess_player', 'football_iq'));

alter table public.round_secrets add column if not exists reveal jsonb;

-- The sixth argument is defaulted, so the old five-argument call still
-- resolves and still creates a guess-the-player room.
drop function if exists public.create_room(text, jsonb, text, text, text);

create or replace function public.create_room(
  p_scope_id text,
  p_scope_clauses jsonb,
  p_display_name text,
  p_scope_name text default null,
  p_scope_icon text default null,
  p_game_mode text default 'guess_player'
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

  if p_game_mode is null or p_game_mode not in ('guess_player', 'football_iq') then
    raise exception 'unknown game mode' using errcode = '22023';
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
      insert into public.rooms (code, creator_id, scope_id, scope_clauses, scope_name, scope_icon, game_mode)
      values (
        v_code, auth.uid(), p_scope_id, coalesce(p_scope_clauses, '[]'::jsonb),
        left(coalesce(p_scope_name, ''), 60),
        left(coalesce(p_scope_icon, ''), 8),
        p_game_mode
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

create or replace function public.current_round(
  p_room_id uuid,
  p_on_demand boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_total int;
  v_index int;
  v_clues jsonb;
  v_payload jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'not a member of that room' using errcode = '42501';
  end if;

  perform public.advance_room(p_room_id);

  -- The poll is the heartbeat, so liveness costs no extra traffic. It
  -- comes after the advance so that every transaction takes the room's
  -- lock before it takes a membership's.
  update public.room_memberships
  set last_seen_at = now()
  where room_id = p_room_id and user_id = auth.uid();

  select * into v_room from public.rooms where id = p_room_id;

  select * into v_round
  from public.rounds
  where room_id = p_room_id and round_number = v_room.current_round;

  if v_round.id is null then
    return jsonb_build_object(
      'status', v_room.status,
      'current_round', v_room.current_round,
      'total_rounds', v_room.total_rounds,
      'scope_id', v_room.scope_id,
      'scope_name', v_room.scope_name,
      'game_mode', v_room.game_mode,
      'round', null
    );
  end if;

  v_total := jsonb_array_length(coalesce(v_round.clues, '[]'::jsonb));

  if p_on_demand then
    select p.clue_index into v_index
    from public.round_progress p
    where p.round_id = v_round.id and p.user_id = auth.uid();
    v_index := least(greatest(coalesce(v_index, 0), 0), greatest(v_total - 1, 0));

    select coalesce(jsonb_agg(
      case
        when (ordinality - 1) <= v_index then c
        else jsonb_build_object(
          'id', c->>'id',
          'label', c->>'label',
          'value', null,
          'iconKey', c->'iconKey'
        )
      end
      order by ordinality
    ), '[]'::jsonb)
    into v_clues
    from jsonb_array_elements(coalesce(v_round.clues, '[]'::jsonb)) with ordinality as t(c, ordinality);
  else
    v_index := 0;
    v_clues := v_round.clues;
  end if;

  v_payload := jsonb_build_object(
    'id', v_round.id,
    'round_number', v_round.round_number,
    'template', v_round.template,
    'prompt', v_round.prompt,
    'context', v_round.context,
    'clues', v_clues,
    'options', v_round.options,
    'reveal_schedule', v_round.reveal_schedule,
    'started_at', v_round.started_at,
    'deadline_at', v_round.deadline_at,
    'clue_index', v_index,
    'clue_total', v_total,
    'clue_family', v_round.clue_family
  );

  if p_on_demand then
    v_payload := v_payload - 'reveal_schedule';
  end if;

  return jsonb_build_object(
    'status', v_room.status,
    'current_round', v_room.current_round,
    'total_rounds', v_room.total_rounds,
    'scope_id', v_room.scope_id,
    'scope_name', v_room.scope_name,
    'game_mode', v_room.game_mode,
    'round', v_payload
  );
end;
$$;

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

  select * into v_room from public.rooms where id = p_room_id for no key update;
  if v_room.id is null or v_room.status <> 'round_active' then
    return;
  end if;

  select * into v_round
  from public.rounds
  where room_id = p_room_id and round_number = v_room.current_round;
  if v_round.id is null then
    return;
  end if;

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

  update public.answers a
  set guessed_answer = t.guessed_answer,
      is_correct = t.is_correct,
      stage_locked = t.stage_locked,
      response_time_ms = t.response_time_ms,
      points_earned = case when t.is_correct then t.points_earned / 2 else 0 end
  from public.room_effects e
  join public.answers t
    on t.round_id = e.round_id and t.user_id = e.target_id
  where e.round_id = v_round.id
    and e.kind = 'steal'
    and a.round_id = e.round_id
    and a.user_id = e.actor_id
    and not exists (
      select 1 from public.room_effects x
      where x.round_id = e.round_id
        and x.actor_id = e.target_id
        and x.kind = 'steal'
    );

  update public.room_effects e
  set resolved_at = now()
  where e.round_id = v_round.id
    and e.kind = 'steal'
    and e.resolved_at is null;

  update public.room_effects e
  set bonus_points = case
        when exists (
          select 1 from public.answers a
          where a.round_id = e.round_id and a.user_id = e.actor_id
        )
        and exists (
          select 1 from public.answers t
          where t.round_id = e.round_id
            and t.user_id = e.target_id
            and t.is_correct
        )
      then 500
      else 0
      end,
      resolved_at = now()
  where e.round_id = v_round.id
    and e.kind = 'side_bet'
    and e.resolved_at is null;

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

  update public.room_memberships m
  set total_score = m.total_score + b.bonus
  from (
    select actor_id, sum(bonus_points) as bonus
    from public.room_effects
    where round_id = v_round.id
      and kind = 'side_bet'
      and resolved_at is not null
    group by actor_id
  ) b
  where m.room_id = p_room_id and m.user_id = b.actor_id and b.bonus > 0;

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
    clues, options, reveal_schedule, clue_family, started_at, deadline_at
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
    v_next->'client'->>'clue_family',
    v_started,
    v_started + interval '20 seconds'
  )
  returning * into v_next_round;

  insert into public.round_secrets (round_id, answer_value, target_player_id, unit, reveal)
  values (
    v_next_round.id,
    v_next->'secret'->>'answer_value',
    nullif(v_next->'secret'->>'target_player_id', '')::bigint,
    nullif(v_next->'secret'->>'unit', ''),
    v_next->'secret'->'reveal'
  );

  update public.rooms
  set current_round = current_round + 1, status = 'round_active'
  where id = p_room_id;
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
  v_effects jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'not a member of that room' using errcode = '42501';
  end if;

  perform public.advance_room(p_room_id);

  select * into v_round
  from public.rounds
  where room_id = p_room_id and round_number = p_round_number;
  if v_round.id is null then
    raise exception 'no such round' using errcode = 'P0002';
  end if;

  if v_round.closed_at is null and now() <= v_round.deadline_at then
    return jsonb_build_object('pending', true, 'round_number', p_round_number);
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

  select jsonb_build_object(
      'correct', a.is_correct,
      'points', a.points_earned,
      'stage', a.stage_locked,
      'response_time_ms', a.response_time_ms,
      'guessed_answer', a.guessed_answer
    ) into v_mine
  from public.answers a
  where a.round_id = v_round.id and a.user_id = auth.uid();

  select coalesce(jsonb_agg(jsonb_build_object(
      'kind', e.kind,
      'actor_id', e.actor_id,
      'target_id', e.target_id,
      'actor_points', coalesce(a.points_earned, 0),
      'target_correct', coalesce(t.is_correct, false),
      'target_answered', t.user_id is not null,
      'target_stole', exists (
        select 1 from public.room_effects x
        where x.round_id = e.round_id
          and x.actor_id = e.target_id
          and x.kind = 'steal'
      ),
      'bonus_points', e.bonus_points,
      'resolved', e.resolved_at is not null
    ) order by e.created_at, e.id), '[]'::jsonb)
  into v_effects
  from public.room_effects e
  left join public.answers a
    on a.round_id = e.round_id and a.user_id = e.actor_id
  left join public.answers t
    on t.round_id = e.round_id and t.user_id = e.target_id
  where e.round_id = v_round.id;

  return jsonb_build_object(
    'round_number', p_round_number,
    'answer', v_secret.answer_value,
    'unit', v_secret.unit,
    'target_player_id', v_secret.target_player_id,
    'reveal', v_secret.reveal,
    'game_mode', (select game_mode from public.rooms where id = p_room_id),
    'clue_family', v_round.clue_family,
    'clue_total', jsonb_array_length(coalesce(v_round.clues, '[]'::jsonb)),
    'leaderboard', v_leaderboard,
    'my_answer', v_mine,
    'effects', v_effects
  );
end;
$$;

notify pgrst, 'reload schema';
