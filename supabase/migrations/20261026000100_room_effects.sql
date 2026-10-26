-- Party effects: one blind steal and one side bet per player per game.
--
-- This table holds relationships and bonuses, never answers. A steal's
-- copied answer lives in public.answers, written at round close.

create table if not exists public.room_effects (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  target_id uuid not null references auth.users(id),
  kind text not null check (kind in ('steal','side_bet')),
  bonus_points int not null default 0,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint room_effects_one_per_kind unique (room_id, actor_id, kind),
  constraint room_effects_not_self check (actor_id <> target_id)
);
create index if not exists room_effects_round_idx on public.room_effects (round_id);
create index if not exists room_effects_target_idx on public.room_effects (target_id, round_id);

alter table public.room_effects enable row level security;

drop policy if exists room_effects_select on public.room_effects;
create policy room_effects_select on public.room_effects for select
  using (
    public.is_room_member(room_id)
    and (
      actor_id = auth.uid()
      or (kind = 'steal' and target_id = auth.uid())
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_effects'
  ) then
    alter publication supabase_realtime add table public.room_effects;
  end if;
end;
$$;

create or replace function public.use_room_effect(
  p_room_id uuid,
  p_round_number int,
  p_kind text,
  p_target_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_existing public.room_effects;
  v_effect public.room_effects;
  v_stage int;
  v_elapsed int;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'not a member of that room' using errcode = '42501';
  end if;

  if p_kind is null or p_kind not in ('steal', 'side_bet') then
    raise exception 'unknown effect' using errcode = '22023';
  end if;

  -- A lost response must not cost the player the effect. Check the spent
  -- effect before the clock so a retry after the close still returns it.
  select e.* into v_existing
  from public.room_effects e
  where e.room_id = p_room_id
    and e.actor_id = auth.uid()
    and e.kind = p_kind;

  if v_existing.id is not null then
    if exists (
      select 1 from public.rounds r
      where r.id = v_existing.round_id and r.round_number = p_round_number
    ) then
      return jsonb_build_object(
        'kind', v_existing.kind,
        'target_user_id', v_existing.target_id,
        'round_number', p_round_number,
        'already', true
      );
    end if;
    raise exception 'you already used that effect this game' using errcode = '22023';
  end if;

  -- The same lock advance_room takes. An effect either lands before the
  -- close and is resolved, or is refused because the round closed.
  select * into v_room from public.rooms where id = p_room_id for no key update;
  if v_room.id is null or v_room.status <> 'round_active' then
    raise exception 'that game is not running' using errcode = '22023';
  end if;

  if v_room.current_round <> p_round_number then
    raise exception 'that round is not open' using errcode = '22023';
  end if;

  select * into v_round
  from public.rounds
  where room_id = p_room_id and round_number = p_round_number;
  if v_round.id is null then
    raise exception 'that round is not open' using errcode = '22023';
  end if;

  if v_round.closed_at is not null or now() > v_round.deadline_at then
    raise exception 'too late - that round is over' using errcode = '22023';
  end if;

  if p_target_user_id = auth.uid() then
    raise exception 'you cannot use an effect on yourself' using errcode = '22023';
  end if;

  if p_target_user_id is null or not exists (
    select 1 from public.room_memberships m
    where m.room_id = p_room_id and m.user_id = p_target_user_id
  ) then
    raise exception 'that player is not in the room' using errcode = '22023';
  end if;

  if p_kind = 'steal' and exists (
    select 1 from public.answers a
    where a.round_id = v_round.id and a.user_id = auth.uid()
  ) then
    raise exception 'you already answered this round' using errcode = '22023';
  end if;

  begin
    insert into public.room_effects (room_id, round_id, actor_id, target_id, kind)
    values (p_room_id, v_round.id, auth.uid(), p_target_user_id, p_kind)
    returning * into v_effect;
  exception when unique_violation then
    -- A concurrent tap won the race. Return its row, not an error.
    select e.* into v_existing
    from public.room_effects e
    where e.room_id = p_room_id and e.actor_id = auth.uid() and e.kind = p_kind;
    if v_existing.round_id = v_round.id then
      return jsonb_build_object(
        'kind', v_existing.kind,
        'target_user_id', v_existing.target_id,
        'round_number', p_round_number,
        'already', true
      );
    end if;
    raise exception 'you already used that effect this game' using errcode = '22023';
  end;

  if p_kind = 'steal' then
    v_elapsed := greatest(
      0,
      floor(extract(epoch from (now() - v_round.started_at)) * 1000)::int
    );
    select greatest(1, count(*)::int) into v_stage
    from jsonb_array_elements(v_round.reveal_schedule) s
    where v_elapsed >= coalesce((s->>'revealAtMs')::int, 0);

    begin
      insert into public.answers (
        room_id, round_id, user_id, guessed_answer, is_correct,
        stage_locked, response_time_ms, points_earned, received_at
      ) values (
        p_room_id, v_round.id, auth.uid(), '', false,
        v_stage, v_elapsed, 0, now()
      );
    exception when unique_violation then
      -- The whole function rolls back, so there is no effect without a
      -- placeholder.
      raise exception 'you already answered this round' using errcode = '22023';
    end;
  end if;

  return jsonb_build_object(
    'kind', p_kind,
    'target_user_id', p_target_user_id,
    'round_number', p_round_number,
    'already', false
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
    'leaderboard', v_leaderboard,
    'my_answer', v_mine,
    'effects', v_effects
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
  v_effects jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_state := public.current_round(p_room_id);

  select max(r.round_number) into v_answered_round
  from public.answers a
  join public.rounds r on r.id = a.round_id
  where a.room_id = p_room_id and a.user_id = auth.uid();

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

  select coalesce(jsonb_agg(jsonb_build_object(
      'round_number', r.round_number,
      'kind', e.kind,
      'role', case when e.actor_id = auth.uid() then 'actor' else 'target' end,
      'other_id', case when e.actor_id = auth.uid() then e.target_id else e.actor_id end,
      'resolved', e.resolved_at is not null,
      'bonus_points', e.bonus_points
    ) order by r.round_number, e.created_at, e.id), '[]'::jsonb)
  into v_effects
  from public.room_effects e
  join public.rounds r on r.id = e.round_id
  where e.room_id = p_room_id
    and (
      e.actor_id = auth.uid()
      or (e.kind = 'steal' and e.target_id = auth.uid())
    );

  return v_state || jsonb_build_object(
    'my_answered_round', v_answered_round,
    'my_answer', v_mine,
    'my_effects', v_effects,
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
