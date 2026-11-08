import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRound,
  applyMembers,
  applyLeaderboard,
  applyEffects,
  applyReactions,
  labelFor,
  reactionName,
} from '../../client/src/room-state.js';

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

test('a rematch clears the last game when the room returns to the lobby', () => {
  const state = {
    status: 'final',
    round: null,
    currentRound: 1,
    totalRounds: 1,
    myAnswer: { points: 100 },
    answeredRound: 1,
    lastResult: { round_number: 1 },
    fetchingResult: true,
    myEffects: [{ kind: 'steal' }],
    lastResultAskedAt: 5,
  };
  applyRound(state, { status: 'lobby', current_round: 0, total_rounds: 1, round: null });
  assert.equal(state.status, 'lobby');
  assert.equal(state.myAnswer, null);
  assert.equal(state.answeredRound, null);
  assert.equal(state.lastResult, null);
  assert.equal(state.fetchingResult, false);
  assert.deepEqual(state.myEffects, []);
  assert.equal(state.lastResultAskedAt, null);
});

test('a rematch clears a game the player never saw finish', () => {
  const state = {
    status: 'round_active',
    round: { id: 'old', round_number: 1 },
    myAnswer: { points: 100 },
    answeredRound: 1,
    lastResult: { round_number: 1 },
    myEffects: [{ kind: 'steal' }],
  };
  applyRound(state, { status: 'lobby', current_round: 0, round: null });
  assert.equal(state.myAnswer, null);
  assert.equal(state.answeredRound, null);
  assert.equal(state.lastResult, null);
  assert.deepEqual(state.myEffects, []);
});

test('round one of a new game clears the last game even when the number repeats', () => {
  const state = {
    round: { id: 'old', round_number: 1 },
    myAnswer: { points: 100 },
    answeredRound: 1,
    lastResult: { round_number: 1, answer: 'old game' },
  };
  applyRound(state, { status: 'round_active', round: { id: 'new', round_number: 1 } });
  assert.equal(state.myAnswer, null);
  assert.equal(state.answeredRound, null);
  assert.equal(state.lastResult, null);
});

test('a poll that races a reveal cannot move the clue ladder backwards', () => {
  const state = {
    round: {
      id: 'r1', round_number: 1, clue_index: 2,
      clues: [{ value: 'one' }, { value: 'two' }, { value: 'three' }],
    },
  };
  applyRound(state, {
    current_round: 1,
    round: {
      id: 'r1', round_number: 1, clue_index: 1,
      clues: [{ value: 'one' }, { value: null }, { value: null }],
    },
  });
  assert.equal(state.round.clue_index, 2);
  assert.equal(state.round.clues[1].value, 'two');
});

test('a higher clue index from the server wins', () => {
  const state = {
    round: { id: 'r1', round_number: 1, clue_index: 0, clues: [{ value: 'one' }, { value: null }] },
  };
  applyRound(state, {
    current_round: 1,
    round: { id: 'r1', round_number: 1, clue_index: 1, clues: [{ value: 'one' }, { value: 'two' }] },
  });
  assert.equal(state.round.clue_index, 1);
  assert.equal(state.round.clues[1].value, 'two');
});

test('reactions are folded in with the round they belong to', () => {
  const state = {};
  applyReactions(state, {
    reactions_round: 3,
    reactions: [{ user_id: 'a', display_name: 'Alex', reaction: 'knew_it' }],
  });
  assert.equal(state.reactionsRound, 3);
  assert.equal(state.reactions.length, 1);
  assert.equal(state.reactions[0].reaction, 'knew_it');
});

test('a lobby reset clears reactions and the reaction round', () => {
  const state = {
    round: { round_number: 1 },
    reactionsRound: 1,
    reactions: [{ user_id: 'a', reaction: 'knew_it' }],
    reportedRound: 1,
  };
  applyRound(state, {
    status: 'lobby',
    current_round: 0,
    total_rounds: 10,
    round: null,
  });
  assert.equal(state.reactionsRound, null);
  assert.deepEqual(state.reactions, []);
  assert.equal(state.reportedRound, null);
});

test('a new game round one clears a stale report state', () => {
  const state = {
    round: { id: 'old', round_number: 10 },
    answeredRound: 10,
    reportedRound: 10,
    lastResult: { round_number: 10 },
  };
  applyRound(state, {
    current_round: 1,
    round: { id: 'new', round_number: 1 },
  });
  assert.equal(state.reportedRound, null);
});

test('a payload without reaction keys leaves the reactions alone', () => {
  const state = {
    reactionsRound: 2,
    reactions: [{ user_id: 'a', reaction: 'fair_play' }],
  };
  applyReactions(state, { my_answered_round: 2 });
  assert.equal(state.reactionsRound, 2);
  assert.equal(state.reactions[0].reaction, 'fair_play');
});

test('a reaction name follows the live room and falls back to the stored name', () => {
  const state = {
    members: [
      { user_id: 'a', joined_seq: 1, display_name: 'Alex' },
      { user_id: 'b', joined_seq: 2, display_name: 'Alex' },
    ],
    leaderboard: [],
  };
  assert.equal(
    reactionName(state, { user_id: 'b', display_name: 'Alex', reaction: 'knew_it' }),
    'Alex #2',
  );
  assert.equal(
    reactionName(state, { user_id: 'gone', display_name: 'Sam', reaction: 'no_chance' }),
    'Sam',
  );
});
