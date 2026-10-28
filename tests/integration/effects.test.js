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

test('a correct steal copies the answer for half points and the target keeps full', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  const steal = await useEffect(sam, room.id, 1, 'steal', alex.userId);
  assert.equal(steal.error, null, steal.error?.message);
  await addAnswer(server, room, round, alex, { correct: true, points: 7500 });
  await closeRound(alex, room.id);

  const { data: answers } = await server
    .from('answers').select('*').eq('round_id', round.id);
  const thief = answers.find((a) => a.user_id === sam.userId);
  const target = answers.find((a) => a.user_id === alex.userId);
  assert.equal(thief.guessed_answer, 'Lionel Messi');
  assert.equal(thief.is_correct, true);
  assert.equal(thief.points_earned, 3750);
  assert.equal(thief.stage_locked, target.stage_locked);
  assert.equal(thief.response_time_ms, target.response_time_ms);
  assert.equal(target.points_earned, 7500, 'the target keeps the full score');

  const { data: board } = await server.from('room_memberships')
    .select('user_id, total_score, correct_count').eq('room_id', room.id);
  const samRow = board.find((m) => m.user_id === sam.userId);
  assert.equal(samRow.total_score, 3750);
  assert.equal(samRow.correct_count, 1);
});

test('a wrong steal copies the wrong guess and scores nothing', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  await useEffect(sam, room.id, 1, 'steal', alex.userId);
  await addAnswer(server, room, round, alex, {
    correct: false, guessed: 'Definitely Not The Answer',
  });
  await closeRound(alex, room.id);

  const { data: answers } = await server
    .from('answers').select('*').eq('round_id', round.id);
  const thief = answers.find((a) => a.user_id === sam.userId);
  assert.equal(thief.guessed_answer, 'Definitely Not The Answer');
  assert.equal(thief.is_correct, false);
  assert.equal(thief.points_earned, 0);
});

test('a steal of a player who did not answer scores nothing', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  await useEffect(sam, room.id, 1, 'steal', alex.userId);
  await expireRound(server, round);
  await closeRound(alex, room.id);

  const { data: thief } = await server.from('answers')
    .select('*').eq('round_id', round.id).eq('user_id', sam.userId).single();
  assert.equal(thief.guessed_answer, '');
  assert.equal(thief.is_correct, false);
  assert.equal(thief.points_earned, 0);
});

test('no chains: a steal of a stealer copies nothing', { skip }, async () => {
  const { room, round, players, server } = await setupRoom({ players: 3 });
  const [alex, sam, robin] = players;

  await useEffect(robin, room.id, 1, 'steal', sam.userId);
  await useEffect(sam, room.id, 1, 'steal', alex.userId);
  await addAnswer(server, room, round, alex, { correct: true, points: 7500 });
  await closeRound(alex, room.id);

  const { data: answers } = await server
    .from('answers').select('*').eq('round_id', round.id);
  const samAnswer = answers.find((a) => a.user_id === sam.userId);
  const robinAnswer = answers.find((a) => a.user_id === robin.userId);
  assert.equal(samAnswer.points_earned, 3750, 'Sam copies Alex');
  assert.equal(robinAnswer.points_earned, 0, 'Robin cannot copy a stealer');
});

test('mutual steals both fail', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  await useEffect(alex, room.id, 1, 'steal', sam.userId);
  await useEffect(sam, room.id, 1, 'steal', alex.userId);
  await closeRound(alex, room.id);

  const { data: answers } = await server
    .from('answers').select('*').eq('round_id', round.id);
  assert.ok(answers.every((a) => a.points_earned === 0), 'both placeholders stay zero');
});

test('two thieves on one correct victim each get half', { skip }, async () => {
  const { room, round, players, server } = await setupRoom({ players: 3 });
  const [alex, sam, robin] = players;

  await useEffect(sam, room.id, 1, 'steal', alex.userId);
  await useEffect(robin, room.id, 1, 'steal', alex.userId);
  await addAnswer(server, room, round, alex, { correct: true, points: 7500 });
  await closeRound(alex, room.id);

  const { data: answers } = await server
    .from('answers').select('*').eq('round_id', round.id);
  const samAnswer = answers.find((a) => a.user_id === sam.userId);
  const robinAnswer = answers.find((a) => a.user_id === robin.userId);
  const target = answers.find((a) => a.user_id === alex.userId);
  assert.equal(samAnswer.points_earned, 3750);
  assert.equal(robinAnswer.points_earned, 3750);
  assert.equal(target.points_earned, 7500);
});

test('a steal placeholder lets the round close when everyone else has answered', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  await useEffect(sam, room.id, 1, 'steal', alex.userId);
  await addAnswer(server, room, round, alex);
  await closeRound(alex, room.id);

  const { data: closed } = await server
    .from('rounds').select('closed_at').eq('id', round.id).single();
  assert.ok(closed.closed_at, 'the placeholder counted as Sam having played');
});

test('a side bet pays +500 when the target is correct and the bettor answered', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  await useEffect(sam, room.id, 1, 'side_bet', alex.userId);
  await addAnswer(server, room, round, alex, { correct: true, points: 7500 });
  await addAnswer(server, room, round, sam, { correct: true, points: 5000 });
  await closeRound(alex, room.id);

  const { data: effect } = await server.from('room_effects')
    .select('*').eq('room_id', room.id).eq('actor_id', sam.userId).eq('kind', 'side_bet').single();
  assert.equal(effect.bonus_points, 500);
  assert.ok(effect.resolved_at);

  const { data: samRow } = await server.from('room_memberships')
    .select('total_score').eq('room_id', room.id).eq('user_id', sam.userId).single();
  assert.equal(samRow.total_score, 5500, 'own points plus the side bet');
});

test('a side bet pays nothing when the target is wrong or the bettor did not play', { skip }, async () => {
  const wrong = await setupRoom();
  const [alexWrong, samWrong] = wrong.players;
  await useEffect(samWrong, wrong.room.id, 1, 'side_bet', alexWrong.userId);
  await addAnswer(wrong.server, wrong.room, wrong.round, alexWrong, {
    correct: false, guessed: 'Wrong',
  });
  await addAnswer(wrong.server, wrong.room, wrong.round, samWrong, { correct: true, points: 5000 });
  await closeRound(alexWrong, wrong.room.id);
  const { data: wrongEffect } = await wrong.server.from('room_effects')
    .select('bonus_points').eq('room_id', wrong.room.id).single();
  assert.equal(wrongEffect.bonus_points, 0);

  const idle = await setupRoom();
  const [alexIdle, samIdle] = idle.players;
  await useEffect(samIdle, idle.room.id, 1, 'side_bet', alexIdle.userId);
  await addAnswer(idle.server, idle.room, idle.round, alexIdle, { correct: true, points: 7500 });
  await expireRound(idle.server, idle.round);
  await closeRound(alexIdle, idle.room.id);
  const { data: idleEffect } = await idle.server.from('room_effects')
    .select('bonus_points').eq('room_id', idle.room.id).single();
  assert.equal(idleEffect.bonus_points, 0, 'no answer or steal means no bet');
});

test('a side bet on a successful stealer pays', { skip }, async () => {
  const { room, round, players, server } = await setupRoom({ players: 3 });
  const [alex, sam, robin] = players;

  await useEffect(sam, room.id, 1, 'side_bet', alex.userId);
  await addAnswer(server, room, round, sam, { correct: true, points: 3000 });
  await useEffect(alex, room.id, 1, 'steal', robin.userId);
  await addAnswer(server, room, round, robin, { correct: true, points: 7500 });
  await closeRound(sam, room.id);

  const { data: alexAnswer } = await server.from('answers')
    .select('*').eq('round_id', round.id).eq('user_id', alex.userId).single();
  assert.equal(alexAnswer.points_earned, 3750, 'the stealer copied correctly');

  const { data: bet } = await server.from('room_effects')
    .select('bonus_points').eq('room_id', room.id)
    .eq('actor_id', sam.userId).eq('kind', 'side_bet').single();
  assert.equal(bet.bonus_points, 500);
});

test('a side bet pays when the bettor stole instead of answering', { skip }, async () => {
  const { room, round, players, server } = await setupRoom({ players: 3 });
  const [alex, sam, robin] = players;

  // Sam has no normal answer, only a steal placeholder. The bet still
  // counts, because Sam played the round.
  await useEffect(sam, room.id, 1, 'side_bet', alex.userId);
  await useEffect(sam, room.id, 1, 'steal', robin.userId);
  await addAnswer(server, room, round, alex, { correct: true, points: 7500 });
  await addAnswer(server, room, round, robin, { correct: true, points: 7500 });
  await closeRound(alex, room.id);

  const { data: bet } = await server.from('room_effects')
    .select('bonus_points').eq('room_id', room.id)
    .eq('actor_id', sam.userId).eq('kind', 'side_bet').single();
  assert.equal(bet.bonus_points, 500);
});

test('the result resolves effects and returns the copied answer', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  await useEffect(sam, room.id, 1, 'steal', alex.userId);
  await addAnswer(server, room, round, alex, { correct: true, points: 7500 });
  await expireRound(server, round);

  // The deadline has passed. round_result itself must close and resolve.
  const { data, error } = await sam.client.rpc('round_result', {
    p_room_id: room.id, p_round_number: 1,
  });
  assert.equal(error, null, error?.message);
  assert.equal(data.my_answer.guessed_answer, 'Lionel Messi');
  assert.equal(data.my_answer.points, 3750);
  assert.equal(data.my_answer.correct, true);

  const steal = data.effects.find((e) => e.kind === 'steal' && e.actor_id === sam.userId);
  assert.equal(steal.target_correct, true);
  assert.equal(steal.target_answered, true);
  assert.equal(steal.target_stole, false);
  assert.equal(steal.actor_points, 3750);
  assert.equal(steal.resolved, true);
});

test('the result exposes no effects while the round is open', { skip }, async () => {
  const { room, players } = await setupRoom();
  const [alex, sam] = players;
  const { data, error } = await alex.client.rpc('round_result', {
    p_room_id: room.id, p_round_number: 1,
  });
  assert.equal(error, null, error?.message);
  assert.equal(data.pending, true);
  assert.equal(data.effects, undefined);
});

test('the victim sees a pending steal and a third player does not', { skip }, async () => {
  const { room, players } = await setupRoom({ players: 3 });
  const [alex, sam, robin] = players;

  await useEffect(sam, room.id, 1, 'steal', alex.userId);

  const { data: victimState } = await alex.client.rpc('sync_room_state', { p_room_id: room.id });
  const row = victimState.my_effects.find((e) => e.kind === 'steal');
  assert.equal(row.role, 'target');
  assert.equal(row.other_id, sam.userId);
  assert.equal(row.resolved, false);

  const { data: thirdState } = await robin.client.rpc('sync_room_state', { p_room_id: room.id });
  assert.equal(thirdState.my_effects.length, 0);
});

test('two thieves on one victim both appear, and a side bet stays with its bettor', { skip }, async () => {
  const { room, players } = await setupRoom({ players: 3 });
  const [alex, sam, robin] = players;

  await useEffect(sam, room.id, 1, 'steal', alex.userId);
  await useEffect(robin, room.id, 1, 'side_bet', alex.userId);
  await useEffect(robin, room.id, 1, 'steal', alex.userId);

  const { data: victimState } = await alex.client.rpc('sync_room_state', { p_room_id: room.id });
  assert.equal(victimState.my_effects.filter((e) => e.kind === 'steal').length, 2);
  assert.equal(victimState.my_effects.some((e) => e.kind === 'side_bet'), false,
    'a side bet is silent to its target');

  const { data: bettorState } = await robin.client.rpc('sync_room_state', { p_room_id: room.id });
  assert.equal(bettorState.my_effects.filter((e) => e.kind === 'steal').length, 1, 'the actor sees their own steal');
  assert.equal(bettorState.my_effects.filter((e) => e.kind === 'side_bet').length, 1);
});

test('a thief cannot submit an answer', { skip }, async () => {
  const { room, players } = await setupRoom();
  const [alex, sam] = players;

  await useEffect(sam, room.id, 1, 'steal', alex.userId);

  const res = await callFunction('submit-answer', {
    room_id: room.id,
    round_number: 1,
    guessed_answer: 'Lionel Messi',
  }, sam.accessToken);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'you are copying a player this round');
});
