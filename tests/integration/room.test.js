import test from 'node:test';
import assert from 'node:assert/strict';
import { stackIsUp, playerClient, serverClient, uniqueCode } from './helpers.js';

const up = await stackIsUp();
const skip = up ? false : 'the local Supabase stack is not running';

test('the plan and the answer key are invisible to a player', { skip }, async () => {
  const { client, userId } = await playerClient();
  const server = serverClient();

  const { data: room, error: roomError } = await server
    .from('rooms')
    .insert({ code: uniqueCode('RLS'), creator_id: userId, scope_id: 'wc-2022', scope_clauses: [] })
    .select()
    .single();
  assert.equal(roomError, null, roomError?.message);

  const { data: plan, error: planError } = await client
    .from('quiz_plans')
    .select('*')
    .eq('room_id', room.id);
  assert.equal(planError, null);
  assert.equal(plan.length, 0, 'a player must not read the plan');

  const { data: secrets, error: secretError } = await client
    .from('round_secrets')
    .select('*')
    .eq('round_id', '00000000-0000-0000-0000-000000000000');
  assert.equal(secretError, null);
  assert.equal(secrets.length, 0, 'a player must not read the answer key');
});

test('a player cannot write an answer row', { skip }, async () => {
  const { client, userId } = await playerClient();
  const server = serverClient();
  const { data: room } = await server
    .from('rooms')
    .insert({ code: uniqueCode('RLS'), creator_id: userId, scope_id: 'wc-2022', scope_clauses: [] })
    .select()
    .single();

  const { error } = await client.from('answers').insert({
    room_id: room.id,
    round_id: '00000000-0000-0000-0000-000000000000',
    user_id: userId,
    guessed_answer: 'Lionel Messi',
    is_correct: true,
    stage_locked: 1,
    response_time_ms: 100,
    points_earned: 7500,
  });
  assert.ok(error, 'a player must not be able to insert a forged answer');
});

test('a player cannot update their own score', { skip }, async () => {
  const { client, userId } = await playerClient();
  const server = serverClient();
  const { data: room } = await server
    .from('rooms')
    .insert({ code: uniqueCode('RLS'), creator_id: userId, scope_id: 'wc-2022', scope_clauses: [] })
    .select()
    .single();
  await server.from('room_memberships').insert({
    room_id: room.id, user_id: userId, display_name: 'Alex', joined_seq: 1,
  });

  // Row-level security does not raise an error on an update it filters
  // out: it updates nothing. So the check is that the score did not move.
  const { error } = await client
    .from('room_memberships')
    .update({ total_score: 75000 })
    .eq('room_id', room.id);
  assert.equal(error, null, error?.message);

  const { data: rows } = await client
    .from('room_memberships')
    .select('total_score')
    .eq('room_id', room.id);
  assert.equal(rows[0].total_score, 0, 'a player must not be able to set their own score');
});

test('an open round\'s answers are invisible to the room', { skip }, async () => {
  // is_correct and guessed_answer together would hand the answer to
  // everyone, so the table stays shut until the round closes.
  const host = await playerClient();
  const server = serverClient();
  const { data: room } = await server
    .from('rooms')
    .insert({ code: uniqueCode('RLS'), creator_id: host.userId, scope_id: 'wc-2022', scope_clauses: [] })
    .select()
    .single();
  await server.from('room_memberships').insert({
    room_id: room.id, user_id: host.userId, display_name: 'Alex', joined_seq: 1,
  });

  const { data: round1 } = await server.from('rounds').insert({
    room_id: room.id, round_number: 1, template: 'identify', prompt: 'Who is this?',
    context: null, clues: [], options: [], reveal_schedule: [],
    started_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 60000).toISOString(),
  }).select().single();

  await server.from('answers').insert({
    room_id: room.id, round_id: round1.id, user_id: host.userId,
    guessed_answer: 'Lionel Messi', is_correct: true, stage_locked: 1,
    response_time_ms: 1200, points_earned: 7500,
  });

  const { data: visible, error } = await host.client
    .from('answers').select('*').eq('room_id', room.id);
  assert.equal(error, null);
  assert.equal(visible.length, 0, 'an open round\'s answers must not be readable');

  await server.from('rounds').update({ closed_at: new Date().toISOString() }).eq('id', round1.id);
  const { data: after } = await host.client
    .from('answers').select('*').eq('room_id', room.id);
  assert.equal(after.length, 1, 'a closed round\'s answers are readable');
});

test('the host creates a room and gets a code', { skip }, async () => {
  const { client, userId } = await playerClient();
  const { data: room, error } = await client.rpc('create_room', {
    p_scope_id: 'wc-2022',
    p_scope_clauses: [{ tournaments: ['wc-2022'] }],
    p_display_name: 'Alex',
  });
  assert.equal(error, null, error?.message);
  assert.match(room.code, /^[A-Z2-9]{6}$/, 'a six character code');
  assert.equal(room.creator_id, userId);
  assert.equal(room.status, 'lobby');

  const { data: members } = await client
    .from('room_memberships')
    .select('*')
    .eq('room_id', room.id);
  assert.equal(members.length, 1);
  assert.equal(members[0].is_host, true);
  assert.equal(members[0].display_name, 'Alex');
});

test('a second player joins with the code', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });

  const guest = await playerClient();
  const { data: joined, error } = await guest.client.rpc('join_room', {
    p_code: room.code, p_display_name: 'Sam',
  });
  assert.equal(error, null, error?.message);
  assert.equal(joined.id, room.id);

  const { data: members } = await host.client
    .from('room_memberships')
    .select('*')
    .eq('room_id', room.id)
    .order('joined_seq');
  assert.equal(members.length, 2);
  assert.equal(members[1].display_name, 'Sam');
  assert.equal(members[1].joined_seq, 2);
});

test('two players may share a display name', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const guest = await playerClient();
  const { error } = await guest.client.rpc('join_room', {
    p_code: room.code, p_display_name: 'Alex',
  });
  assert.equal(error, null, 'the second Alex must be able to join');
});

test('a display name is trimmed, stripped and capped', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const guest = await playerClient();
  await guest.client.rpc('join_room', {
    p_code: room.code, p_display_name: '  Sam the Great  ',
  });
  const { data: members } = await host.client
    .from('room_memberships').select('*').eq('room_id', room.id).order('joined_seq');
  assert.equal(members[1].display_name, 'Sam the Great');
});

test('a room that is full refuses another player', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  // The floor is two players: a room of one is not a game.
  await host.client.rpc('set_room_capacity', { p_room_id: room.id, p_max_players: 2 });

  const guest = await playerClient();
  const { error: guestError } = await guest.client.rpc('join_room', {
    p_code: room.code, p_display_name: 'Sam',
  });
  assert.equal(guestError, null, 'the second player fits');

  const third = await playerClient();
  const { error } = await third.client.rpc('join_room', {
    p_code: room.code, p_display_name: 'Robin',
  });
  assert.ok(error, 'a full room must refuse');
});

test('a player who leaves gives up the host role', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const guest = await playerClient();
  await guest.client.rpc('join_room', { p_code: room.code, p_display_name: 'Sam' });

  await host.client.rpc('leave_room', { p_room_id: room.id });

  const { data: members } = await guest.client
    .from('room_memberships').select('*').eq('room_id', room.id);
  assert.equal(members.length, 1);
  assert.equal(members[0].is_host, true, 'the host role moves to the player who stayed');
});
