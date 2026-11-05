import test from 'node:test';
import assert from 'node:assert/strict';
import { stackIsUp, playerClient, serverClient, callFunction } from './helpers.js';

const up = await stackIsUp();
const skip = up ? false : 'the local Supabase stack is not running';

/** A started Football IQ room. One round unless told otherwise. */
async function iqRoom({ rounds = 1 } = {}) {
  const host = await playerClient();
  const guest = await playerClient();
  const { data: room, error } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022',
    p_scope_clauses: [],
    p_display_name: 'Alex',
    p_game_mode: 'football_iq',
  });
  assert.equal(error, null, error?.message);
  assert.equal(room.game_mode, 'football_iq');

  const joined = await guest.client.rpc('join_room', {
    p_code: room.code, p_display_name: 'Sam',
  });
  assert.equal(joined.error, null, joined.error?.message);

  if (rounds !== 10) {
    const server = serverClient();
    const { error: updateError } = await server.from('rooms')
      .update({ total_rounds: rounds }).eq('id', room.id);
    assert.equal(updateError, null, updateError?.message);
  }

  const started = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  return { room, host, guest, round: started.body };
}

test('create_room stores the mode and defaults to guess-the-player', { skip }, async () => {
  const host = await playerClient();
  const iq = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
    p_game_mode: 'football_iq',
  });
  assert.equal(iq.error, null, iq.error?.message);
  assert.equal(iq.data.game_mode, 'football_iq');

  const plain = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  assert.equal(plain.error, null, plain.error?.message);
  assert.equal(plain.data.game_mode, 'guess_player');

  const bad = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
    p_game_mode: 'trivia',
  });
  assert.ok(bad.error, 'an unknown mode must be refused');
});

test('a ten-round Football IQ plan uses the four formats and no identify', { skip }, async () => {
  const { room } = await iqRoom({ rounds: 10 });
  const server = serverClient();
  const { data: plan, error } = await server.from('quiz_plans')
    .select('*').eq('room_id', room.id).single();
  assert.equal(error, null, error?.message);

  const templates = plan.plan.map((entry) => entry.client.template);
  assert.deepEqual(
    [...new Set(templates)].sort(),
    ['club', 'comparison', 'range', 'teammate'],
  );
  assert.equal(templates.filter((t) => t === 'identify').length, 0);
  assert.equal(templates.filter((t) => t === 'stat_value').length, 0);
  assert.equal(plan.plan.length, 10);
  for (const entry of plan.plan) {
    assert.equal(entry.client.clue_family, null);
    assert.equal(entry.secret.reveal.format, entry.client.template);
  }
});

test('current_round carries the mode but never the reveal', { skip }, async () => {
  const { room, guest } = await iqRoom();
  const view = await guest.client.rpc('current_round', {
    p_room_id: room.id, p_on_demand: true,
  });
  assert.equal(view.error, null, view.error?.message);
  assert.equal(view.data.game_mode, 'football_iq');
  assert.equal(view.data.round.reveal, undefined);
  assert.equal(JSON.stringify(view.data).includes('"reveal"'), false);
});

test('round_result returns the reveal and the mode once the round closes', { skip }, async () => {
  const { room, host, guest, round } = await iqRoom();
  const server = serverClient();
  const { data: secret } = await server.from('round_secrets')
    .select('*').eq('round_id', round.id).single();
  assert.ok(secret.reveal, 'the first round stores its reveal');

  for (const player of [host, guest]) {
    const answer = await callFunction('submit-answer', {
      room_id: room.id,
      round_number: 1,
      guessed_answer: secret.answer_value,
      on_demand: true,
    }, player.accessToken);
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
  }

  const closed = await guest.client.rpc('current_round', {
    p_room_id: room.id, p_on_demand: true,
  });
  assert.equal(closed.data.status, 'final');

  const result = await guest.client.rpc('round_result', {
    p_room_id: room.id, p_round_number: 1,
  });
  assert.equal(result.error, null, result.error?.message);
  assert.equal(result.data.game_mode, 'football_iq');
  assert.equal(result.data.reveal.format, round.template);
  assert.equal(result.data.answer, secret.answer_value);
});

test('a rematch keeps the Football IQ mode and plans a fresh IQ quiz', { skip }, async () => {
  const { room, host, guest, round } = await iqRoom();
  const server = serverClient();
  const { data: secret } = await server.from('round_secrets')
    .select('*').eq('round_id', round.id).single();

  for (const player of [host, guest]) {
    await callFunction('submit-answer', {
      room_id: room.id,
      round_number: 1,
      guessed_answer: secret.answer_value,
      on_demand: true,
    }, player.accessToken);
  }
  await guest.client.rpc('current_round', { p_room_id: room.id, p_on_demand: true });

  const reset = await host.client.rpc('reset_room', { p_room_id: room.id });
  assert.equal(reset.error, null, reset.error?.message);

  const { data: afterReset } = await server.from('rooms')
    .select('*').eq('id', room.id).single();
  assert.equal(afterReset.game_mode, 'football_iq');

  const restarted = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(restarted.status, 200, JSON.stringify(restarted.body));

  const { data: plan } = await server.from('quiz_plans')
    .select('*').eq('room_id', room.id).single();
  assert.ok(plan.plan.every((entry) => entry.client.template !== 'identify'));
});
