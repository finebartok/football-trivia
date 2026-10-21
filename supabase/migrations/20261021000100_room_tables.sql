-- The room. Everything a player may see is here; everything a player may
-- not see is somewhere they cannot reach.

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  creator_id uuid not null references auth.users(id),
  scope_id text not null,
  scope_clauses jsonb not null default '[]'::jsonb,
  difficulty text not null default 'medium' check (difficulty in ('easy','medium','hard')),
  status text not null default 'lobby' check (status in ('lobby','round_active','round_ended','final','abandoned')),
  max_players int not null default 12,
  current_round int not null default 0,
  total_rounds int not null default 10,
  pool_size int not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists rooms_code_idx on public.rooms (code);
create index if not exists rooms_creator_idx on public.rooms (creator_id);

create table if not exists public.room_memberships (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  display_name text not null,
  is_host boolean not null default false,
  joined_seq int not null,
  last_seen_at timestamptz not null default now(),
  total_score int not null default 0,
  correct_count int not null default 0,
  total_response_ms int not null default 0,
  unique (room_id, user_id)
);
create index if not exists room_memberships_room_idx on public.room_memberships (room_id);

-- The plan. Service role only. A client may never read it.
create table if not exists public.quiz_plans (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  seed bigint not null,
  plan jsonb not null,
  generated_at timestamptz not null default now()
);

-- One row per round, materialised only when that round begins.
create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_number int not null,
  template text not null,
  prompt text not null,
  context text,
  clues jsonb not null,
  options jsonb not null,
  reveal_schedule jsonb not null,
  started_at timestamptz not null,
  deadline_at timestamptz not null,
  closed_at timestamptz,
  unique (room_id, round_number)
);
create index if not exists rounds_room_idx on public.rounds (room_id);

-- The answer key. Service role only. A client may never read it.
create table if not exists public.round_secrets (
  round_id uuid primary key references public.rounds(id) on delete cascade,
  answer_value text not null,
  target_player_id bigint
);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  guessed_answer text not null,
  is_correct boolean not null,
  stage_locked int not null,
  response_time_ms int not null,
  points_earned int not null,
  received_at timestamptz not null default now(),
  unique (round_id, user_id)
);
create index if not exists answers_room_idx on public.answers (room_id);

-- The bucket the server reads the player pool from.
insert into storage.buckets (id, name, public)
values ('pool', 'pool', false)
on conflict (id) do nothing;

alter table public.rooms enable row level security;
alter table public.room_memberships enable row level security;
alter table public.quiz_plans enable row level security;
alter table public.rounds enable row level security;
alter table public.round_secrets enable row level security;
alter table public.answers enable row level security;

-- "Is the caller in this room?" SECURITY DEFINER so it can answer the
-- question without the caller's own row-level security getting in the way.
create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_memberships m
    where m.room_id = p_room_id and m.user_id = auth.uid()
  );
$$;

-- rooms: a member may read it; only the state-machine functions may change it.
create policy rooms_select on public.rooms for select
  using (creator_id = auth.uid() or public.is_room_member(id));
create policy rooms_insert on public.rooms for insert
  with check (creator_id = auth.uid());
create policy rooms_delete on public.rooms for delete
  using (creator_id = auth.uid());

-- room_memberships: readable by the room. Written only by the server.
create policy memberships_select on public.room_memberships for select
  using (public.is_room_member(room_id));

-- quiz_plans: no policy at all. Nobody but the service role reads it.
-- round_secrets: no policy at all. Nobody but the service role reads it.

-- rounds: a member may read a round that has begun. No policy for writes.
create policy rounds_select on public.rounds for select
  using (public.is_room_member(room_id) and started_at <= now());

-- answers: readable only once the round is closed. While a round is open,
-- is_correct and guessed_answer would hand the answer to the whole room.
create policy answers_select on public.answers for select
  using (
    public.is_room_member(room_id)
    and exists (
      select 1 from public.rounds r
      where r.id = answers.round_id and r.closed_at is not null
    )
  );
