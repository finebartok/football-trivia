import test from 'node:test';
import assert from 'node:assert/strict';
import { stackIsUp, playerClient, serverClient } from './helpers.js';

const up = await stackIsUp();
const skip = up ? false : 'the local Supabase stack is not running';

const CLUES = [{ id: 'club-goals', label: 'The season', value: '2015/16' }];
const OPTIONS = [
  { label: 'Sevilla', value: 'sevilla' },
  { label: 'Valencia', value: 'valencia' },
];
const REVEAL = {
  format: 'club',
  club: 'Sevilla',
  season: '2015/16',
  player: { name: 'Joaquín' },
  league: 'La Liga',
  goals: 3,
};

/** A room with one directly-inserted round, as the effects tests do. */
async function setupRoom({ players = 2, deadlineMs = 60000, totalRounds = 10 } = {}) {
  const host = await playerClient();
  const { data: room, error } = await host.client.rpc('create_room', {
    p_scope_id: 'wc-2022',
    p_scope_clauses: [],
    p_display_name: 'Alex',
    p_scope_name: 'World Cup 2022',
    p_game_mode: 'football_iq',
  });
  assert.equal(error, null, error?.message);

  const made = [{ ...host, name: 'Alex' }];
  const names = ['Sam', 'Robin'];
  for (let i = 1; i < players; i++) {
    const p = await playerClient();
    const joined = await p.client.rpc('join_room', {
      p_code: room.code,
      p_display_name: names[i - 1],
    });
    assert.equal(joined.error, null, joined.error?.message);
    made.push({ ...p, name: names[i - 1] });
  }

  const server = serverClient();
  if (totalRounds !== 10) {
    const { error: roundsError } = await server.from('rooms')
      .update({ total_rounds: totalRounds })
      .eq('id', room.id);
    assert.equal(roundsError, null, roundsError?.message);
  }

  const { data: round, error: roundError } = await server.from('rounds').insert({
    room_id: room.id,
    round_number: 1,
    template: 'club',
    prompt: 'Which club did Joaquín join in 2015/16?',
    context: 'La Liga',
    clues: CLUES,
    options: OPTIONS,
    reveal_schedule: [{ stage: 1, revealAtMs: 500 }],
    clue_family: null,
    started_at: new Date(Date.now() - 1000).toISOString(),
    deadline_at: new Date(Date.now() + deadlineMs).toISOString(),
  }).select().single();
  assert.equal(roundError, null, roundError?.message);

  const { error: secretError } = await server.from('round_secrets').insert({
    round_id: round.id,
    answer_value: 'Sevilla',
    unit: null,
    reveal: REVEAL,
  });
  assert.equal(secretError, null, secretError?.message);

  const { error: roomError } = await server.from('rooms').update({
    status: 'round_active',
    current_round: 1,
  }).eq('id', room.id);
  assert.equal(roomError, null, roomError?.message);

  return { room, round, players: made, server, host };
}

async function addAnswer(server, room, round, player, {
  correct = true,
  points = 7500,
  guessed = 'Sevilla',
  ms = 1000,
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

async function expireRound(server, round) {
  const { error } = await server.from('rounds')
    .update({ deadline_at: new Date(Date.now() - 1000).toISOString() })
    .eq('id', round.id);
  assert.equal(error, null, error?.message);
}

/** Ask the server to advance; it closes the round when the clock says so. */
async function closeRound(player, roomId) {
  const { data, error } = await player.client.rpc('current_round', {
    p_room_id: roomId,
  });
  assert.equal(error, null, error?.message);
  return data;
}

function react(player, roomId, roundNumber, reaction) {
  return player.client.rpc('react_to_round', {
    p_room_id: roomId,
    p_round_number: roundNumber,
    p_reaction: reaction,
  });
}

function report(player, roomId, roundNumber, reason, note = null) {
  return player.client.rpc('report_round', {
    p_room_id: roomId,
    p_round_number: roundNumber,
    p_reason: reason,
    p_note: note,
  });
}

test('a reaction is refused while the round is open and stored after the deadline', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex] = players;
  await addAnswer(server, room, round, alex);

  const early = await react(alex, room.id, 1, 'knew_it');
  assert.match(early.error.message, /the round is still open/);

  await expireRound(server, round);
  const late = await react(alex, room.id, 1, 'knew_it');
  assert.equal(late.error, null, late.error?.message);
  assert.equal(late.data.ok, true);
  assert.equal(late.data.reaction, 'knew_it');

  const { data: rows } = await server.from('round_reactions')
    .select('*')
    .eq('round_id', round.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, alex.userId);
  assert.equal(rows[0].display_name, 'Alex');
  assert.equal(rows[0].reaction, 'knew_it');
});

test('a report is refused while the round is open and stored after the deadline', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex] = players;

  const early = await report(alex, room.id, 1, 'ambiguous');
  assert.match(early.error.message, /the round is still open/);

  await expireRound(server, round);
  const late = await report(alex, room.id, 1, 'ambiguous');
  assert.equal(late.error, null, late.error?.message);
  assert.equal(late.data.ok, true);

  const { data: rows } = await server.from('round_reports')
    .select('reason')
    .eq('round_id', round.id);
  assert.deepEqual(rows, [{ reason: 'ambiguous' }]);
});

test('a duplicate reaction returns the first choice and does not change it', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex] = players;
  await expireRound(server, round);

  const first = await react(alex, room.id, 1, 'fair_play');
  assert.equal(first.error, null, first.error?.message);

  const second = await react(alex, room.id, 1, 'no_chance');
  assert.equal(second.error, null, second.error?.message);
  assert.equal(second.data.reaction, 'fair_play');

  const { data: rows } = await server.from('round_reactions')
    .select('reaction')
    .eq('round_id', round.id);
  assert.deepEqual(rows, [{ reaction: 'fair_play' }]);
});

test('a non-member and an unknown reaction are refused', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex] = players;
  await expireRound(server, round);

  const stranger = await playerClient();
  const outsider = await react(stranger, room.id, 1, 'knew_it');
  assert.match(outsider.error.message, /not a member of that room/);

  const unknown = await react(alex, room.id, 1, 'bored');
  assert.match(unknown.error.message, /unknown reaction/);
});

test('sync shows reactions only after the round closes and only to a player who revealed it', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;
  await addAnswer(server, room, round, alex);

  const open = await alex.client.rpc('sync_room_state', { p_room_id: room.id });
  assert.equal(open.error, null, open.error?.message);
  assert.equal(open.data.reactions_round, 1);
  assert.deepEqual(open.data.reactions, []);

  await expireRound(server, round);
  await closeRound(alex, room.id);

  const first = await react(alex, room.id, 1, 'knew_it');
  assert.equal(first.error, null, first.error?.message);
  const second = await react(sam, room.id, 1, 'no_chance');
  assert.equal(second.error, null, second.error?.message);

  const closed = await alex.client.rpc('sync_room_state', { p_room_id: room.id });
  assert.equal(closed.error, null, closed.error?.message);
  assert.equal(closed.data.reactions_round, 1);
  assert.deepEqual(
    closed.data.reactions.map((r) => [r.display_name, r.reaction]).sort(),
    [['Alex', 'knew_it'], ['Sam', 'no_chance']],
  );

  const watcher = await sam.client.rpc('sync_room_state', { p_room_id: room.id });
  assert.equal(watcher.error, null, watcher.error?.message);
  assert.equal(watcher.data.reactions_round, null);
  assert.deepEqual(watcher.data.reactions, []);
});

test('a thief with a placeholder answer still gets reactions for that round', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;

  const steal = await sam.client.rpc('use_room_effect', {
    p_room_id: room.id,
    p_round_number: 1,
    p_kind: 'steal',
    p_target_user_id: alex.userId,
  });
  assert.equal(steal.error, null, steal.error?.message);

  await addAnswer(server, room, round, alex);
  await expireRound(server, round);
  await closeRound(alex, room.id);

  const seen = await sam.client.rpc('sync_room_state', { p_room_id: room.id });
  assert.equal(seen.error, null, seen.error?.message);
  assert.equal(seen.data.reactions_round, 1);

  const reacted = await react(alex, room.id, 1, 'fair_play');
  assert.equal(reacted.error, null, reacted.error?.message);

  const after = await sam.client.rpc('sync_room_state', { p_room_id: room.id });
  assert.equal(after.error, null, after.error?.message);
  assert.deepEqual(after.data.reactions.map((r) => r.display_name), ['Alex']);
});

test('a reaction keeps its name after the player leaves the room', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;
  await addAnswer(server, room, round, alex);
  await expireRound(server, round);
  await closeRound(alex, room.id);

  const made = await react(sam, room.id, 1, 'no_chance');
  assert.equal(made.error, null, made.error?.message);

  const left = await sam.client.rpc('leave_room', { p_room_id: room.id });
  assert.equal(left.error, null, left.error?.message);

  const seen = await alex.client.rpc('sync_room_state', { p_room_id: room.id });
  assert.equal(seen.error, null, seen.error?.message);
  assert.deepEqual(seen.data.reactions.map((r) => r.display_name), ['Sam']);
});

test('a report stores the reason, trimmed note and the frozen question', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex] = players;
  await addAnswer(server, room, round, alex);
  await expireRound(server, round);
  await closeRound(alex, room.id);

  const made = await report(alex, room.id, 1, 'ambiguous', '  Too many Messis  ');
  assert.equal(made.error, null, made.error?.message);

  const { data: rows, error } = await server.from('round_reports')
    .select('*')
    .eq('room_id', room.id);
  assert.equal(error, null, error?.message);
  assert.equal(rows.length, 1);

  const row = rows[0];
  assert.equal(row.round_id, round.id);
  assert.equal(row.round_number, 1);
  assert.equal(row.user_id, alex.userId);
  assert.equal(row.reason, 'ambiguous');
  assert.equal(row.note, 'Too many Messis');
  assert.equal(row.question.game_mode, 'football_iq');
  assert.equal(row.question.format, 'club');
  assert.equal(row.question.clue_family, null);
  assert.equal(row.question.prompt, 'Which club did Joaquín join in 2015/16?');
  assert.equal(row.question.context, 'La Liga');
  assert.deepEqual(row.question.clues, CLUES);
  assert.deepEqual(row.question.options, OPTIONS);
  assert.equal(row.question.answer, 'Sevilla');
  assert.equal(row.question.unit, null);
  assert.deepEqual(row.question.reveal, REVEAL);
  assert.equal(row.question.scope_id, 'wc-2022');
  assert.equal(row.question.scope_name, 'World Cup 2022');
  assert.deepEqual(row.question.scope_clauses, []);
});

test('a report rejects bad input and a duplicate is a no-op', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex, sam] = players;
  await expireRound(server, round);

  const unknown = await report(alex, room.id, 1, 'boring');
  assert.match(unknown.error.message, /unknown reason/);

  const long = await report(alex, room.id, 1, 'other', 'x'.repeat(281));
  assert.match(long.error.message, /note is too long/);

  const empty = await report(alex, room.id, 1, 'other', '   ');
  assert.equal(empty.error, null, empty.error?.message);

  const first = await report(sam, room.id, 1, 'two_answers', 'both are right');
  assert.equal(first.error, null, first.error?.message);
  const duplicate = await report(sam, room.id, 1, 'looks_wrong', 'changed my mind');
  assert.equal(duplicate.error, null, duplicate.error?.message);

  const { data: rows } = await server.from('round_reports')
    .select('*')
    .eq('room_id', room.id);
  assert.equal(rows.length, 2);

  const alexRow = rows.find((r) => r.user_id === alex.userId);
  const samRow = rows.find((r) => r.user_id === sam.userId);
  assert.equal(alexRow.note, null);
  assert.equal(samRow.reason, 'two_answers');
  assert.equal(samRow.note, 'both are right');
});

test('a report survives a rematch and a fresh report is accepted', { skip }, async () => {
  const { room, round, players, server } = await setupRoom({ totalRounds: 1 });
  const [alex] = players;
  await addAnswer(server, room, round, alex);
  await expireRound(server, round);
  await closeRound(alex, room.id);

  const made = await report(alex, room.id, 1, 'looks_wrong', 'the answer is wrong');
  assert.equal(made.error, null, made.error?.message);

  const reset = await alex.client.rpc('reset_room', { p_room_id: room.id });
  assert.equal(reset.error, null, reset.error?.message);

  const { data: kept } = await server.from('round_reports')
    .select('*')
    .eq('room_id', room.id);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].round_id, null);
  assert.equal(kept[0].question.prompt, 'Which club did Joaquín join in 2015/16?');

  const { data: nextRound, error: nextError } = await server.from('rounds').insert({
    room_id: room.id,
    round_number: 1,
    template: 'club',
    prompt: 'A new question?',
    context: null,
    clues: [],
    options: [],
    reveal_schedule: [],
    clue_family: null,
    started_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() - 1000).toISOString(),
  }).select().single();
  assert.equal(nextError, null, nextError?.message);

  const { error: secretError } = await server.from('round_secrets').insert({
    round_id: nextRound.id,
    answer_value: 'Sevilla',
  });
  assert.equal(secretError, null, secretError?.message);

  const { error: roomError } = await server.from('rooms').update({
    status: 'round_active',
    current_round: 1,
  }).eq('id', room.id);
  assert.equal(roomError, null, roomError?.message);

  const fresh = await report(alex, room.id, 1, 'other', 'new game');
  assert.equal(fresh.error, null, fresh.error?.message);

  const { data: both } = await server.from('round_reports')
    .select('*')
    .eq('room_id', room.id);
  assert.equal(both.length, 2);
  assert.equal(both.filter((r) => r.round_id === nextRound.id).length, 1);
});

test('clients cannot read the tables or the review view directly', { skip }, async () => {
  const { room, round, players, server } = await setupRoom();
  const [alex] = players;
  await expireRound(server, round);
  await react(alex, room.id, 1, 'knew_it');
  await report(alex, room.id, 1, 'ambiguous', 'nope');

  const reactions = await alex.client.from('round_reactions').select('*');
  assert.equal(reactions.error, null);
  assert.deepEqual(reactions.data, []);

  const reports = await alex.client.from('round_reports').select('*');
  assert.equal(reports.error, null);
  assert.deepEqual(reports.data, []);

  const view = await alex.client.from('question_reports').select('*');
  assert.ok(view.error, 'the review view is not readable by a player');

  const serviceView = await server.from('question_reports')
    .select('*')
    .eq('room_id', room.id);
  assert.equal(serviceView.error, null, serviceView.error?.message);
  assert.equal(serviceView.data.length, 1);
  assert.equal(serviceView.data[0].reason, 'ambiguous');
});
