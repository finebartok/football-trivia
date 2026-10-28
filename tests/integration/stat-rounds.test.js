import test from 'node:test';
import assert from 'node:assert/strict';
import { stackIsUp, playerClient, serverClient, callFunction } from './helpers.js';

const up = await stackIsUp();
const skip = up ? false : 'the local Supabase stack is not running';

/** A started one-round room. The planner clamps the mix to one stat round. */
async function oneRoundRoom() {
  const host = await playerClient();
  const guest = await playerClient();
  const { data: room, error } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  assert.equal(error, null, error?.message);
  const joined = await guest.client.rpc('join_room', {
    p_code: room.code, p_display_name: 'Sam',
  });
  assert.equal(joined.error, null, joined.error?.message);

  const server = serverClient();
  const { error: updateError } = await server.from('rooms')
    .update({ total_rounds: 1 }).eq('id', room.id);
  assert.equal(updateError, null, updateError?.message);

  const started = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  return { room, host, guest, server, round: started.body };
}

test('a ten-round room plan has three stat rounds and seven identity rounds', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const started = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(started.status, 200, JSON.stringify(started.body));

  const server = serverClient();
  const { data: plan } = await server.from('quiz_plans')
    .select('*').eq('room_id', room.id).single();
  const templates = plan.plan.map((round) => round.client.template);
  assert.equal(templates.filter((t) => t === 'stat_value').length, 3);
  assert.equal(templates.filter((t) => t === 'identify').length, 7);
});

test('a one-round room starts on a stat round with unit-labelled options', { skip }, async () => {
  const { room, host, guest, server, round } = await oneRoundRoom();
  assert.equal(round.template, 'stat_value');
  assert.match(round.prompt, /^How many /);
  assert.equal(round.options.length, 4);
  for (const option of round.options) {
    assert.match(option.label, /^\d[\d,]*\s+\w+$/, `"${option.label}" has no unit`);
  }

  const { data: secret } = await server.from('round_secrets')
    .select('*').eq('round_id', round.id).single();
  assert.ok(secret.unit, 'the answer key carries the unit');

  const answer = await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: secret.answer_value,
  }, guest.accessToken);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.equal(answer.body.correct, true);

  // The host has no answer of their own, so move the deadline back rather
  // than waiting twenty seconds for the round to close.
  await server.from('rounds')
    .update({ deadline_at: new Date(Date.now() - 1000).toISOString() })
    .eq('id', round.id);
  await host.client.rpc('current_round', { p_room_id: room.id });

  const result = await guest.client.rpc('round_result', {
    p_room_id: room.id, p_round_number: 1,
  });
  assert.equal(result.error, null, result.error?.message);
  assert.equal(result.data.unit, secret.unit);
  assert.equal(String(result.data.answer), String(secret.answer_value));
});

test('a steal on a stat round copies the numeric answer and half the points', { skip }, async () => {
  const { room, host, guest, server, round } = await oneRoundRoom();
  const { data: secret } = await server.from('round_secrets')
    .select('*').eq('round_id', round.id).single();

  const steal = await host.client.rpc('use_room_effect', {
    p_room_id: room.id,
    p_round_number: 1,
    p_kind: 'steal',
    p_target_user_id: guest.userId,
  });
  assert.equal(steal.error, null, steal.error?.message);

  // The victim can still bet on the thief's copied answer.
  const bet = await guest.client.rpc('use_room_effect', {
    p_room_id: room.id,
    p_round_number: 1,
    p_kind: 'side_bet',
    p_target_user_id: host.userId,
  });
  assert.equal(bet.error, null, bet.error?.message);

  const answer = await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: secret.answer_value,
  }, guest.accessToken);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.equal(answer.body.correct, true);
  const guestPoints = answer.body.points;

  // The thief's placeholder answer means the victim's answer closes the
  // round without waiting for the deadline.
  const closed = await host.client.rpc('current_round', { p_room_id: room.id });
  assert.equal(closed.error, null, closed.error?.message);

  const { data: answers } = await server.from('answers')
    .select('*').eq('room_id', room.id);
  const thief = answers.find((a) => a.user_id === host.userId);
  const victim = answers.find((a) => a.user_id === guest.userId);
  assert.equal(thief.guessed_answer, String(secret.answer_value));
  assert.equal(thief.is_correct, true);
  assert.equal(thief.points_earned, Math.floor(guestPoints / 2));
  assert.equal(victim.points_earned, guestPoints);

  // The side bet pays because the thief's copied answer is correct.
  const { data: effects } = await server.from('room_effects')
    .select('*').eq('room_id', room.id);
  const sideBet = effects.find((e) => e.kind === 'side_bet' && e.actor_id === guest.userId);
  assert.equal(sideBet.bonus_points, 500);
});
