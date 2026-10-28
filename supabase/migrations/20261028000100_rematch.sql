-- A rematch: the host returns a finished room to its lobby.
--
-- The room row, its code, its members and their join order stay. The game
-- itself - plan, rounds, answers, secrets and effects - is deleted, and the
-- scores go back to zero. The next start-room writes a fresh quiz with a
-- new seed.

create or replace function public.reset_room(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms;
  v_is_host boolean;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into v_room from public.rooms where id = p_room_id for update;
  if v_room.id is null then
    raise exception 'no such room' using errcode = 'P0002';
  end if;

  select m.is_host into v_is_host
  from public.room_memberships m
  where m.room_id = p_room_id and m.user_id = auth.uid();

  if not coalesce(v_is_host, false) then
    raise exception 'only the host can start a rematch' using errcode = '42501';
  end if;

  if v_room.status <> 'final' then
    raise exception 'the game is not finished' using errcode = '22023';
  end if;

  delete from public.quiz_plans where room_id = p_room_id;
  delete from public.rounds where room_id = p_room_id;

  update public.room_memberships
  set total_score = 0,
      correct_count = 0,
      total_response_ms = 0
  where room_id = p_room_id;

  update public.rooms
  set status = 'lobby',
      current_round = 0,
      finished_at = null
  where id = p_room_id;

  return jsonb_build_object('ok', true);
end;
$$;
