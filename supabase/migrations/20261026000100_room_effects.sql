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
