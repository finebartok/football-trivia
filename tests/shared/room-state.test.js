import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRound, applyMembers, applyLeaderboard, applyEffects, labelFor } from '../../client/src/room-state.js';

test('the room round replaces the previous one', () => {
  const state = { round: null };
  applyRound(state, { current_round: 2, round: { round_number: 2, prompt: 'Who is this?' } });
  assert.equal(state.round.round_number, 2);
  assert.equal(state.round.prompt, 'Who is this?');
});

test('a null round clears it', () => {
  const state = { round: { round_number: 1 } };
  applyRound(state, { current_round: 0, round: null });
  assert.equal(state.round, null);
});

test('members are listed in join order', () => {
  const state = { members: [] };
  applyMembers(state, [{ joined_seq: 2, display_name: 'Sam' }, { joined_seq: 1, display_name: 'Alex' }]);
  assert.deepEqual(state.members.map((m) => m.display_name), ['Alex', 'Sam']);
});

test('two players with the same name are told apart', () => {
  const state = { members: [] };
  applyMembers(state, [
    { user_id: 'a', joined_seq: 1, display_name: 'Alex' },
    { user_id: 'b', joined_seq: 2, display_name: 'Alex' },
  ]);
  assert.equal(labelFor(state, 'a'), 'Alex');
  assert.equal(labelFor(state, 'b'), 'Alex #2');
});

test('the leaderboard is ordered by points, then correct, then speed', () => {
  const state = { leaderboard: [] };
  applyLeaderboard(state, [
    { user_id: 'a', display_name: 'Slow', total_score: 100, correct_count: 1, total_response_ms: 9000 },
    { user_id: 'b', display_name: 'Fast', total_score: 100, correct_count: 1, total_response_ms: 3000 },
    { user_id: 'c', display_name: 'Top', total_score: 500, correct_count: 2, total_response_ms: 9000 },
  ]);
  assert.deepEqual(state.leaderboard.map((m) => m.display_name), ['Top', 'Fast', 'Slow']);
});

test('a new round forgets the last answer', () => {
  const state = {
    round: { round_number: 1 },
    myAnswer: { correct: true, points: 7500 },
    answeredRound: 1,
    lastResult: { answer: 'Lionel Messi' },
    fetchingResult: true,
  };
  applyRound(state, { current_round: 2, round: { round_number: 2 } });
  assert.equal(state.myAnswer, null);
  assert.equal(state.answeredRound, null);
  assert.equal(state.lastResult, null);
  assert.equal(state.fetchingResult, false);
});

test('effects replace the player effect list', () => {
  const state = {
    myEffects: [{ round_number: 1, kind: 'steal', role: 'actor' }],
  };
  applyEffects(state, [
    { round_number: 1, kind: 'steal', role: 'actor', other_id: 'a' },
    { round_number: 2, kind: 'side_bet', role: 'target', other_id: 'b' },
  ]);
  assert.equal(state.myEffects.length, 2);
  assert.equal(state.myEffects[1].kind, 'side_bet');
});

test('an empty effect list clears the used buttons', () => {
  const state = { myEffects: [{ round_number: 1, kind: 'steal' }] };
  applyEffects(state, []);
  assert.deepEqual(state.myEffects, []);
});

test('a new round keeps the effects already used', () => {
  const state = {
    round: { round_number: 1 },
    myEffects: [{ round_number: 1, kind: 'steal', role: 'actor' }],
  };
  applyRound(state, { current_round: 2, round: { round_number: 2 } });
  assert.equal(state.myEffects.length, 1);
});

test('a new round preserves the result it just fetched', () => {
  const state = {
    round: { round_number: 1 },
    myAnswer: { correct: true, points: 7500 },
    answeredRound: 1,
    lastResult: { round_number: 1, answer: 'Lionel Messi' },
    fetchingResult: true,
  };
  applyRound(state, { current_round: 2, round: { round_number: 2 } });
  assert.deepEqual(state.lastResult, { round_number: 1, answer: 'Lionel Messi' });
  assert.equal(state.myAnswer, null);
  assert.equal(state.answeredRound, null);
  assert.equal(state.fetchingResult, false);
});

test('a new round drops a result for a different round', () => {
  const state = {
    round: { round_number: 1 },
    answeredRound: 1,
    lastResult: { round_number: 0, answer: 'Old' },
  };
  applyRound(state, { current_round: 2, round: { round_number: 2 } });
  assert.equal(state.lastResult, null);
});

test('the same round keeps the answer', () => {
  const state = {
    round: { round_number: 1 },
    myAnswer: { correct: true, points: 7500 },
    answeredRound: 1,
    lastResult: { answer: 'Lionel Messi' },
    fetchingResult: true,
  };
  applyRound(state, { current_round: 1, round: { round_number: 1 } });
  assert.equal(state.myAnswer.points, 7500);
  assert.equal(state.answeredRound, 1);
  assert.deepEqual(state.lastResult, { answer: 'Lionel Messi' });
});
