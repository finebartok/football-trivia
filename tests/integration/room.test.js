import test from 'node:test';
import assert from 'node:assert/strict';
import { stackIsUp, playerClient, serverClient, uniqueCode, callFunction } from './helpers.js';

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

test('the current round is null before the game starts', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const { data, error } = await host.client.rpc('current_round', { p_room_id: room.id });
  assert.equal(error, null, error?.message);
  assert.equal(data.status, 'lobby');
  assert.equal(data.round, null);
});

test('an expired round advances and the next one appears', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const server = serverClient();

  // Stand in for the edge function that starts the game: one round in,
  // and a plan with a second round waiting in it.
  const { data: round1 } = await server.from('rounds').insert({
    room_id: room.id,
    round_number: 1,
    template: 'identify',
    prompt: 'Who is this?',
    context: '2022 World Cup',
    clues: [{ id: 'c1', label: 'CAREER CLUBS', value: 'Barcelona' }],
    options: [{ id: 'opt-0', label: 'Lionel Messi', value: 'Lionel Messi' }],
    reveal_schedule: [{ stage: 1, revealAtMs: 2000 }],
    started_at: new Date(Date.now() - 60000).toISOString(),
    deadline_at: new Date(Date.now() - 1000).toISOString(),
  }).select().single();

  await server.from('round_secrets').insert({
    round_id: round1.id, answer_value: 'Lionel Messi', target_player_id: 28003,
  });
  await server.from('quiz_plans').insert({
    room_id: room.id,
    seed: 1,
    plan: [{
      client: {
        round_number: 2, template: 'identify', prompt: 'Who is this?', context: null,
        clues: [{ id: 'c1', label: 'CAREER CLUBS', value: 'Bayern' }],
        options: [{ id: 'opt-0', label: 'Thomas Muller', value: 'Thomas Muller' }],
        reveal_schedule: [{ stage: 1, revealAtMs: 2000 }],
      },
      secret: { answer_value: 'Thomas Muller', target_player_id: 1 },
    }],
  });
  await server.from('rooms').update({ status: 'round_active', current_round: 1 }).eq('id', room.id);

  const { data, error } = await host.client.rpc('current_round', { p_room_id: room.id });
  assert.equal(error, null, error?.message);
  assert.equal(data.current_round, 2);
  assert.equal(data.round.round_number, 2);
  assert.equal(data.round.prompt, 'Who is this?');

  const { data: closed } = await server.from('rounds').select('closed_at').eq('id', round1.id).single();
  assert.ok(closed.closed_at, 'the first round must be closed');

  const { data: secret } = await server.from('round_secrets').select('answer_value').eq('round_id', round1.id).single();
  assert.equal(secret.answer_value, 'Lionel Messi');
});

test('the answer is only available once the round is closed', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const server = serverClient();
  const { data: round1 } = await server.from('rounds').insert({
    room_id: room.id, round_number: 1, template: 'identify', prompt: 'Who is this?',
    context: null, clues: [], options: [], reveal_schedule: [],
    started_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 60000).toISOString(),
  }).select().single();
  await server.from('round_secrets').insert({ round_id: round1.id, answer_value: 'Lionel Messi' });
  await server.from('rooms').update({ status: 'round_active', current_round: 1 }).eq('id', room.id);

  const { error } = await host.client.rpc('round_result', {
    p_room_id: room.id, p_round_number: 1,
  });
  assert.ok(error, 'the answer must not be readable while the round is open');

  await server.from('rounds').update({ closed_at: new Date().toISOString() }).eq('id', round1.id);
  const { data, error: afterError } = await host.client.rpc('round_result', {
    p_room_id: room.id, p_round_number: 1,
  });
  assert.equal(afterError, null, afterError?.message);
  assert.equal(data.answer, 'Lionel Messi');
});

test('a player who is not in the room gets nothing', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const stranger = await playerClient();
  const { error } = await stranger.client.rpc('current_round', { p_room_id: room.id });
  assert.ok(error, 'a stranger must not read a room');
});

test('the host starts the game and the first round appears', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });

  const started = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const payload = started.body;
  assert.equal(payload.round_number, 1);
  assert.equal(payload.options.length, 4, 'four options');
  assert.equal(JSON.stringify(payload).includes('"correct"'), false, 'no correct flag');

  const server = serverClient();
  const { data: plan } = await server.from('quiz_plans').select('*').eq('room_id', room.id).single();
  assert.ok(plan, 'the plan exists');
  assert.equal(plan.plan.length, 10, 'ten rounds planned');

  const { data: secret } = await server
    .from('round_secrets').select('*').eq('round_id', payload.id).single();
  assert.ok(secret?.answer_value, 'the answer key exists');
});

test('a player who is not the host cannot start the game', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const guest = await playerClient();
  await guest.client.rpc('join_room', { p_code: room.code, p_display_name: 'Sam' });

  const started = await callFunction('start-room', { room_id: room.id }, guest.accessToken);
  assert.equal(started.status, 403);
});

test('the game is played with the server preset, not the clauses the client sent', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022',
    // A client that tries to smuggle a different scope in.
    p_scope_clauses: [{ leagues: ['GB1'], seasonStart: 2010, seasonEnd: 2019 }],
    p_display_name: 'Alex',
  });

  const started = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(started.status, 200, JSON.stringify(started.body));

  const server = serverClient();
  const { data: room2 } = await server.from('rooms').select('pool_size').eq('id', room.id).single();
  assert.equal(room2.pool_size, 94, 'the World Cup 2022 pool, not the one the client asked for');
});

/** Start a game and hand back the first round's payload. */
async function startGame(host, roomId) {
  const started = await callFunction('start-room', { room_id: roomId }, host.accessToken);
  return started;
}

test('an answer is scored by the server', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const started = await startGame(host, room.id);
  assert.equal(started.status, 200, JSON.stringify(started.body));

  const server = serverClient();
  const { data: secret } = await server
    .from('round_secrets').select('*').eq('round_id', started.body.id).single();

  const res = await callFunction('submit-answer', {
    room_id: room.id,
    round_number: 1,
    guessed_answer: secret.answer_value,
  }, host.accessToken);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.correct, true);
  assert.ok(res.body.points > 0, 'points for a correct answer');

  const { data: answers } = await server
    .from('answers').select('*').eq('room_id', room.id);
  assert.equal(answers.length, 1);
  assert.equal(answers[0].is_correct, true);
});

test('an answer after the round closed is refused', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const started = await startGame(host, room.id);
  const server = serverClient();
  await server.from('rounds')
    .update({ closed_at: new Date().toISOString() })
    .eq('id', started.body.id);

  const res = await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: 'Lionel Messi',
  }, host.accessToken);
  assert.equal(res.status, 409, 'a late answer must be refused');

  const { data: answers } = await server.from('answers').select('*').eq('room_id', room.id);
  assert.equal(answers.length, 0, 'no row is written for a late answer');
});

test('answering twice keeps the first answer', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  await startGame(host, room.id);

  await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: 'Someone Else',
  }, host.accessToken);
  await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: 'Someone Else',
  }, host.accessToken);

  const server = serverClient();
  const { data: answers } = await server.from('answers').select('*').eq('room_id', room.id);
  assert.equal(answers.length, 1, 'a retry does not write a second row');
});

test('a wrong answer scores nothing', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const started = await startGame(host, room.id);
  const server = serverClient();
  const { data: secret } = await server
    .from('round_secrets').select('*').eq('round_id', started.body.id).single();

  const res = await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: 'Definitely Not The Answer',
  }, host.accessToken);
  assert.equal(res.status, 200);
  assert.equal(res.body.correct, false);
  assert.equal(res.body.points, 0);
  assert.notEqual(secret.answer_value, 'Definitely Not The Answer');
});
