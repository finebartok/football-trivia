import test from 'node:test';
import assert from 'node:assert/strict';
import { stackIsUp, playerClient, serverClient, callFunction } from './helpers.js';

const up = await stackIsUp();
const skip = up ? false : 'the local Supabase stack is not running';

/** A room with one open round, made directly on the server. */
async function setupRoom({ players = 2, deadlineMs = 60000 } = {}) {
  const host = await playerClient();
  const { data: room, error } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022', p_scope_clauses: [], p_display_name: 'Alex',
  });
  assert.equal(error, null, error?.message);
  const made = [{ ...host, name: 'Alex' }];

  const names = ['Sam', 'Robin'];
  for (let i = 1; i < players; i++) {
    const p = await playerClient();
    const joined = await p.client.rpc('join_room', {
      p_code: room.code, p_display_name: names[i - 1],
    });
    assert.equal(joined.error, null, joined.error?.message);
    made.push({ ...p, name: names[i - 1] });
  }

  const server = serverClient();
  const { data: round } = await server.from('rounds').insert({
    room_id: room.id,
    round_number: 1,
    template: 'identify',
    prompt: 'Who is this?',
    context: null,
    clues: [],
    options: [],
    reveal_schedule: [{ stage: 1, revealAtMs: 500 }],
    started_at: new Date(Date.now() - 1000).toISOString(),
    deadline_at: new Date(Date.now() + deadlineMs).toISOString(),
  }).select().single();
  await server.from('round_secrets').insert({
    round_id: round.id, answer_value: 'Lionel Messi',
  });
  await server.from('rooms').update({
    status: 'round_active', current_round: 1,
  }).eq('id', room.id);

  return { room, round, players: made, server };
}

async function useEffect(player, roomId, roundNumber, kind, targetId) {
  return player.client.rpc('use_room_effect', {
    p_room_id: roomId,
    p_round_number: roundNumber,
    p_kind: kind,
    p_target_user_id: targetId,
  });
}

async function addAnswer(server, room, round, player, {
  correct = true, points = 7500, guessed = 'Lionel Messi', ms = 1000,
} = {}) {
  const { error } = await server.from('answers').insert({
    room_id: room.id,
    round_id: round.id,
    user_id: player.userId,
    guessed_answer: guessed,
    is_correct: correct,
    stage_locked: 1,
    response_time_ms: ms,
    points_earned: correct ? points : 0,
  });
  assert.equal(error, null, error?.message);
}

/** Move the deadline into the past without touching the placement window. */
async function expireRound(server, round) {
  const { error } = await server.from('rounds')
    .update({ deadline_at: new Date(Date.now() - 1000).toISOString() })
    .eq('id', round.id);
  assert.equal(error, null, error?.message);
}

/** Ask the server to advance; it closes the round when the clock says so. */
async function closeRound(player, roomId) {
  const { data, error } = await player.client.rpc('current_round', { p_room_id: roomId });
  assert.equal(error, null, error?.message);
  return data;
}

test('a player cannot write an effect row', { skip }, async () => {
  const { room, round, players } = await setupRoom();
  const [alex, sam] = players;
  const { error } = await alex.client.from('room_effects').insert({
    room_id: room.id,
    round_id: round.id,
    actor_id: alex.userId,
    target_id: sam.userId,
    kind: 'steal',
  });
  assert.ok(error, 'effects are written by the server, not by the client');
});

test('the actor and the steal victim can read an effect, a third player cannot', { skip }, async () => {
  const { room, players, server } = await setupRoom({ players: 3 });
  const [alex, sam, robin] = players;

  const { error } = await useEffect(sam, room.id, 1, 'steal', alex.userId);
  assert.equal(error, null, error?.message);

  const { data: actorRows } = await sam.client
    .from('room_effects').select('*').eq('room_id', room.id);
  assert.equal(actorRows.length, 1, 'the actor sees their own effect');

  const { data: victimRows } = await alex.client
    .from('room_effects').select('*').eq('room_id', room.id);
  assert.equal(victimRows.length, 1, 'the victim sees the steal');

  const { data: thirdRows } = await robin.client
    .from('room_effects').select('*').eq('room_id', room.id);
  assert.equal(thirdRows.length, 0, 'an uninvolved player sees nothing');

  // Reading is allowed for the victim; writing is not, even on their own row.
  const { data: before } = await server.from('room_effects')
    .select('bonus_points').eq('id', actorRows[0].id).single();
  await alex.client.from('room_effects')
    .update({ bonus_points: 999 }).eq('id', actorRows[0].id);
  const { data: after } = await server.from('room_effects')
    .select('bonus_points').eq('id', actorRows[0].id).single();
  assert.equal(after.bonus_points, before.bonus_points, 'a player cannot update an effect');
});

test('the target of a side bet cannot read it mid-round', { skip }, async () => {
  const { room, players } = await setupRoom();
  const [alex, sam] = players;

  const { error } = await useEffect(sam, room.id, 1, 'side_bet', alex.userId);
  assert.equal(error, null, error?.message);

  const { data: targetRows } = await alex.client
    .from('room_effects').select('*').eq('room_id', room.id);
  assert.equal(targetRows.length, 0, 'a side bet is silent to its target');
});

test('a steal is refused after the actor has answered', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;
  await addAnswer(server, room, round, alex);

  const { error } = await useEffect(alex, room.id, 1, 'steal', sam.userId);
  assert.match(error.message, /already answered this round/);
});

test('an effect needs another member as its target', { skip }, async () => {
  const { room, players } = await setupRoom();
  const [alex, sam] = players;

  const self = await useEffect(alex, room.id, 1, 'steal', alex.userId);
  assert.match(self.error.message, /cannot use an effect on yourself/);

  const stranger = await playerClient();
  const other = await useEffect(alex, room.id, 1, 'steal', stranger.userId);
  assert.match(other.error.message, /not in the room/);
});

test('an effect is only placed in the open current round', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  const wrong = await useEffect(alex, room.id, 2, 'steal', sam.userId);
  assert.match(wrong.error.message, /round is not open/);

  await server.from('rounds')
    .update({ closed_at: new Date().toISOString() })
    .eq('id', round.id);
  const closed = await useEffect(alex, room.id, 1, 'steal', sam.userId);
  assert.match(closed.error.message, /too late/);
});

test('an effect after the deadline is too late', { skip }, async () => {
  const { room, players } = await setupRoom({ deadlineMs: -1000 });
  const [alex, sam] = players;
  const { error } = await useEffect(alex, room.id, 1, 'steal', sam.userId);
  assert.match(error.message, /too late/);
});

test('a steal writes one placeholder answer and is idempotent in the same round', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  const first = await useEffect(sam, room.id, 1, 'steal', alex.userId);
  assert.equal(first.error, null, first.error?.message);
  assert.equal(first.data.already, false);

  const retry = await useEffect(sam, room.id, 1, 'steal', alex.userId);
  assert.equal(retry.error, null, retry.error?.message);
  assert.equal(retry.data.already, true);

  const { data: effects } = await server
    .from('room_effects').select('*').eq('room_id', room.id);
  assert.equal(effects.length, 1, 'one effect row');

  const { data: answers } = await server
    .from('answers').select('*').eq('round_id', round.id).eq('user_id', sam.userId);
  assert.equal(answers.length, 1, 'one placeholder');
  assert.equal(answers[0].guessed_answer, '');
  assert.equal(answers[0].points_earned, 0);
});

test('a same-round retry after the round closed returns the first effect', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  const first = await useEffect(sam, room.id, 1, 'steal', alex.userId);
  assert.equal(first.error, null, first.error?.message);

  await expireRound(server, round);
  await closeRound(alex, room.id);

  // The response may have been lost after the close. The retry still
  // returns the effect it spent rather than an error.
  const retry = await useEffect(sam, room.id, 1, 'steal', alex.userId);
  assert.equal(retry.error, null, retry.error?.message);
  assert.equal(retry.data.already, true);
  assert.equal(retry.data.target_user_id, alex.userId);
});

test('each effect is once per game, in a later round too', { skip }, async () => {
  const { room, players, server } = await setupRoom();
  const [alex, sam] = players;

  const first = await useEffect(alex, room.id, 1, 'steal', sam.userId);
  assert.equal(first.error, null, first.error?.message);

  await server.from('rounds').insert({
    room_id: room.id,
    round_number: 2,
    template: 'identify',
    prompt: 'Who is this?',
    context: null,
    clues: [],
    options: [],
    reveal_schedule: [],
    started_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 60000).toISOString(),
  });
  await server.from('rooms').update({ current_round: 2 }).eq('id', room.id);

  const later = await useEffect(alex, room.id, 2, 'steal', sam.userId);
  assert.match(later.error.message, /already used that effect this game/);

  const bet = await useEffect(alex, room.id, 2, 'side_bet', sam.userId);
  assert.equal(bet.error, null, bet.error?.message);
});
