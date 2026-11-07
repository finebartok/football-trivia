-- The Collective Groan and question reports.
--
-- Reactions are social and ephemeral: one per player per round, shown
-- only after the round closes, deleted with the round on a rematch.
--
-- Reports are evidence: the question is frozen at report time, so a
-- rematch can delete the round and keep the report. Both tables are
-- written through security-definer RPCs and read only through
-- sync_room_state or the service role. No client policy exists.

create table if not exists public.round_reactions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  display_name text not null,
  reaction text not null check (reaction in ('knew_it', 'no_chance', 'fair_play')),
  created_at timestamptz not null default now(),
  unique (round_id, user_id)
);
create index if not exists round_reactions_round_idx
  on public.round_reactions (round_id);

alter table public.round_reactions enable row level security;

create table if not exists public.round_reports (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid references public.rounds(id) on delete set null,
  user_id uuid not null references auth.users(id),
  round_number int not null,
  reason text not null check (reason in ('ambiguous', 'two_answers', 'looks_wrong', 'other')),
  note text check (note is null or char_length(note) <= 280),
  question jsonb not null,
  created_at timestamptz not null default now()
);
create unique index if not exists round_reports_once
  on public.round_reports (round_id, user_id)
  where round_id is not null;
create index if not exists round_reports_created_idx
  on public.round_reports (created_at desc);

alter table public.round_reports enable row level security;

create or replace function public.react_to_round(
  p_room_id uuid,
  p_round_number int,
  p_reaction text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.rounds;
  v_existing public.round_reactions;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'not a member of that room' using errcode = '42501';
  end if;

  if p_reaction is null or p_reaction not in ('knew_it', 'no_chance', 'fair_play') then
    raise exception 'unknown reaction' using errcode = '22023';
  end if;

  select * into v_round
  from public.rounds
  where room_id = p_room_id and round_number = p_round_number;

  if v_round.id is null then
    raise exception 'no such round' using errcode = 'P0002';
  end if;

  if v_round.closed_at is null and now() <= v_round.deadline_at then
    raise exception 'the round is still open' using errcode = '22023';
  end if;

  select * into v_existing
  from public.round_reactions
  where round_id = v_round.id and user_id = auth.uid();

  if v_existing.id is null then
    select m.display_name into v_name
    from public.room_memberships m
    where m.room_id = p_room_id and m.user_id = auth.uid();

    insert into public.round_reactions (
      room_id, round_id, user_id, display_name, reaction
    ) values (
      p_room_id, v_round.id, auth.uid(), coalesce(v_name, 'Player'), p_reaction
    )
    on conflict (round_id, user_id) do nothing;

    select * into v_existing
    from public.round_reactions
    where round_id = v_round.id and user_id = auth.uid();
  end if;

  return jsonb_build_object(
    'ok', true,
    'round_number', p_round_number,
    'reaction', v_existing.reaction
  );
end;
$$;

create or replace function public.report_round(
  p_room_id uuid,
  p_round_number int,
  p_reason text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.rounds;
  v_secret public.round_secrets;
  v_room public.rooms;
  v_note text;
  v_question jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not public.is_room_member(p_room_id) then
    raise exception 'not a member of that room' using errcode = '42501';
  end if;

  if p_reason is null or p_reason not in ('ambiguous', 'two_answers', 'looks_wrong', 'other') then
    raise exception 'unknown reason' using errcode = '22023';
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 280 then
    raise exception 'note is too long' using errcode = '22023';
  end if;

  select * into v_round
  from public.rounds
  where room_id = p_room_id and round_number = p_round_number;

  if v_round.id is null then
    raise exception 'no such round' using errcode = 'P0002';
  end if;

  if v_round.closed_at is null and now() <= v_round.deadline_at then
    raise exception 'the round is still open' using errcode = '22023';
  end if;

  select * into v_secret from public.round_secrets where round_id = v_round.id;
  select * into v_room from public.rooms where id = p_room_id;

  v_question := jsonb_build_object(
    'game_mode', v_room.game_mode,
    'format', v_round.template,
    'clue_family', v_round.clue_family,
    'prompt', v_round.prompt,
    'context', v_round.context,
    'clues', v_round.clues,
    'options', v_round.options,
    'answer', v_secret.answer_value,
    'unit', v_secret.unit,
    'reveal', v_secret.reveal,
    'scope_id', v_room.scope_id,
    'scope_name', v_room.scope_name,
    'scope_clauses', v_room.scope_clauses
  );

  insert into public.round_reports (
    room_id, round_id, user_id, round_number, reason, note, question
  ) values (
    p_room_id, v_round.id, auth.uid(), p_round_number, p_reason, v_note, v_question
  )
  on conflict (round_id, user_id) where round_id is not null do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace view public.question_reports as
select
  r.created_at,
  r.room_id,
  r.round_number,
  r.user_id,
  r.reason,
  r.note,
  r.question->>'game_mode' as game_mode,
  r.question->>'format' as format,
  r.question->>'clue_family' as clue_family,
  r.question->>'scope_name' as scope_name,
  r.question->>'scope_id' as scope_id,
  r.question->>'prompt' as prompt,
  r.question->>'context' as context,
  r.question->>'answer' as answer,
  r.question->>'unit' as unit,
  r.question->'clues' as clues,
  r.question->'options' as options,
  r.question->'reveal' as reveal
from public.round_reports r
order by r.created_at desc;

revoke all on public.question_reports from public, anon, authenticated;
grant select on public.question_reports to service_role;

-- The latest definition is in 20261101000100_press_your_luck.sql. This
-- replacement keeps its signature and every existing key, and adds the
-- reaction keys.
create or replace function public.sync_room_state(
  p_room_id uuid,
  p_on_demand boolean default false
)
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
  v_reactions jsonb;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_state := public.current_round(p_room_id, p_on_demand);

  select max(r.round_number) into v_answered_round
  from public.answers a
  join public.rounds r on r.id = a.round_id
  where a.room_id = p_room_id and a.user_id = auth.uid();

  select jsonb_build_object(
      'correct', a.is_correct,
      'points', a.points_earned,
      'stage', a.stage_locked,
      'response_time_ms', a.response_time_ms,
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

  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', x.user_id,
      'display_name', coalesce(m.display_name, x.display_name),
      'reaction', x.reaction
    ) order by x.created_at, x.id), '[]'::jsonb)
  into v_reactions
  from public.round_reactions x
  join public.rounds r on r.id = x.round_id
  left join public.room_memberships m
    on m.room_id = x.room_id and m.user_id = x.user_id
  where x.room_id = p_room_id
    and r.round_number = v_answered_round
    and (r.closed_at is not null or now() > r.deadline_at);

  return v_state || jsonb_build_object(
    'my_answered_round', v_answered_round,
    'my_answer', v_mine,
    'my_effects', v_effects,
    'reactions_round', v_answered_round,
    'reactions', v_reactions,
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

notify pgrst, 'reload schema';
