import test from 'node:test';
import assert from 'node:assert/strict';
import { stackIsUp, playerClient, serverClient, callFunction } from './helpers.js';

const up = await stackIsUp();
const skip = up ? false : 'the local Supabase stack is not running';

/** A final one-round room with scores, an effect, and a stored plan. */
async function finalRoom() {
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

  const { data: secret } = await server.from('round_secrets')
    .select('*').eq('round_id', started.body.id).single();
  for (const player of [host, guest]) {
    const res = await callFunction('submit-answer', {
      room_id: room.id, round_number: 1, guessed_answer: secret.answer_value,
    }, player.accessToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }

  // An effect belongs to the game too; the reset must cascade it away.
  const { error: effectError } = await server.from('room_effects').insert({
    room_id: room.id,
    round_id: started.body.id,
    actor_id: host.userId,
    target_id: guest.userId,
    kind: 'side_bet',
  });
  assert.equal(effectError, null, effectError?.message);

  await host.client.rpc('current_round', { p_room_id: room.id });
  const { data: final } = await server.from('rooms').select('*').eq('id', room.id).single();
  assert.equal(final.status, 'final');

  const { data: scored } = await server.from('room_memberships')
    .select('*').eq('room_id', room.id);
  assert.ok(scored.some((m) => m.total_score > 0), 'the game has scores to clear');

  return { room, host, guest, server, roundId: started.body.id };
}

test('the host resets a final room to the lobby and clears the game', { skip }, async () => {
  const { room, host, guest, server, roundId } = await finalRoom();

  const reset = await host.client.rpc('reset_room', { p_room_id: room.id });
  assert.equal(reset.error, null, reset.error?.message);
  assert.deepEqual(reset.data, { ok: true });

  const { data: after } = await server.from('rooms').select('*').eq('id', room.id).single();
  assert.equal(after.status, 'lobby');
  assert.equal(after.current_round, 0);
  assert.equal(after.finished_at, null);

  for (const table of ['rounds', 'answers', 'quiz_plans']) {
    const { data } = await server.from(table).select('*').eq('room_id', room.id);
    assert.equal(data.length, 0, `${table} is empty after a rematch`);
  }
  const { data: secrets } = await server.from('round_secrets')
    .select('*').eq('round_id', roundId);
  assert.equal(secrets.length, 0, 'the answer key is gone');
  const { data: effects } = await server.from('room_effects')
    .select('*').eq('room_id', room.id);
  assert.equal(effects.length, 0, 'the effects are gone');

  const { data: members } = await server.from('room_memberships')
    .select('*').eq('room_id', room.id).order('joined_seq');
  assert.equal(members.length, 2, 'the players stay');
  assert.equal(members[0].is_host, true);
  assert.equal(members[1].is_host, false);
  for (const m of members) {
    assert.equal(m.total_score, 0);
    assert.equal(m.correct_count, 0);
    assert.equal(m.total_response_ms, 0);
  }

  // The next start is a fresh game in the same room.
  const started = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.notEqual(started.body.id, roundId);
  const { data: rounds } = await server.from('rounds').select('*').eq('room_id', room.id);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].round_number, 1);
  const { data: plan } = await server.from('quiz_plans')
    .select('*').eq('room_id', room.id).single();
  assert.ok(plan.seed, 'a new plan was written');
});

test('only the host can reset, and only a final room', { skip }, async () => {
  const { room, host, guest } = await finalRoom();

  const byGuest = await guest.client.rpc('reset_room', { p_room_id: room.id });
  assert.ok(byGuest.error, 'a guest cannot reset');
  assert.match(byGuest.error.message, /only the host/);

  const reset = await host.client.rpc('reset_room', { p_room_id: room.id });
  assert.equal(reset.error, null, reset.error?.message);

  const again = await host.client.rpc('reset_room', { p_room_id: room.id });
  assert.ok(again.error, 'a lobby is not a finished game');
  assert.match(again.error.message, /not finished/);
});

test('a running room cannot be reset', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const server = serverClient();
  await server.from('rooms').update({ total_rounds: 1 }).eq('id', room.id);
  const started = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(started.status, 200, JSON.stringify(started.body));

  const reset = await host.client.rpc('reset_room', { p_room_id: room.id });
  assert.ok(reset.error, 'a running game cannot be reset');
  assert.match(reset.error.message, /not finished/);
});

test('the new host can reset after the old host leaves', { skip }, async () => {
  const { room, host, guest } = await finalRoom();

  const left = await host.client.rpc('leave_room', { p_room_id: room.id });
  assert.equal(left.error, null, left.error?.message);

  const { data: members } = await guest.client
    .from('room_memberships').select('*').eq('room_id', room.id);
  const hosts = members.filter((m) => m.is_host);
  assert.equal(hosts.length, 1, 'exactly one host');
  assert.equal(hosts[0].user_id, guest.userId, 'the host role moved to the remaining player');

  const reset = await guest.client.rpc('reset_room', { p_room_id: room.id });
  assert.equal(reset.error, null, reset.error?.message);
});

test('a host alone can reset a final room', { skip }, async () => {
  const host = await playerClient();
  const { data: room } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  const server = serverClient();
  await server.from('rooms').update({ total_rounds: 1 }).eq('id', room.id);
  const started = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(started.status, 200, JSON.stringify(started.body));

  const { data: secret } = await server.from('round_secrets')
    .select('*').eq('round_id', started.body.id).single();
  const answer = await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: secret.answer_value,
  }, host.accessToken);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  await host.client.rpc('current_round', { p_room_id: room.id });

  const { data: final } = await server.from('rooms').select('status').eq('id', room.id).single();
  assert.equal(final.status, 'final');
  const reset = await host.client.rpc('reset_room', { p_room_id: room.id });
  assert.equal(reset.error, null, reset.error?.message);
});
