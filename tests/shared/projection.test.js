import test from 'node:test';
import assert from 'node:assert/strict';
import { projectRound } from '../../supabase/functions/_shared/projection.js';

const composed = {
  template: 'identify',
  prompt: 'Who is this?',
  context: '2022 World Cup',
  subjectId: 28003,
  answer: 'Lionel Messi',
  options: [
    { id: 'opt-0', label: 'Lionel Messi', value: 'Lionel Messi', correct: true },
    { id: 'opt-1', label: 'Neymar', value: 'Neymar', correct: false },
  ],
  clues: [{ id: 'c1', label: 'CAREER CLUBS', value: 'Barcelona', iconKey: null }],
  revealSchedule: [{ stage: 1, revealAtMs: 2000 }],
};

test('the client row never says which option is right', () => {
  const { client } = projectRound(composed, 1);
  const json = JSON.stringify(client);
  assert.equal(json.includes('"correct"'), false, 'no option may carry a correct flag');
  assert.equal(client.options.filter((o) => o.correct).length, 0);
});

test('the client row carries only what a player can see on screen', () => {
  const { client } = projectRound(composed, 1);
  assert.deepEqual(Object.keys(client).sort(), [
    'clues', 'context', 'options', 'prompt', 'reveal_schedule', 'round_number', 'template',
  ]);
});

test('the client row keeps the option labels and their raw values', () => {
  const { client } = projectRound(composed, 1);
  assert.deepEqual(client.options, [
    { id: 'opt-0', label: 'Lionel Messi', value: 'Lionel Messi' },
    { id: 'opt-1', label: 'Neymar', value: 'Neymar' },
  ]);
});

test('the client row uses the engine shape the browser already understands', () => {
  const { client } = projectRound(composed, 3);
  assert.equal(client.round_number, 3);
  assert.equal(client.template, 'identify');
  assert.equal(client.prompt, 'Who is this?');
  assert.deepEqual(client.reveal_schedule, [{ stage: 1, revealAtMs: 2000 }]);
});

test('the room prompt carries the hook on its own line', () => {
  const { client } = projectRound({ ...composed, hook: 'A centurion with a World Cup goal.' }, 1);
  assert.equal(client.prompt, 'Who is this?\nA centurion with a World Cup goal.');
});

test('the secret holds the answer', () => {
  const { secret } = projectRound(composed, 1);
  assert.equal(secret.answer_value, 'Lionel Messi');
  assert.equal(secret.target_player_id, 28003);
});

test('a numeric answer is stored as a string', () => {
  const numeric = {
    ...composed,
    template: 'stat_value',
    answer: 3,
    unit: 'goals',
    options: [
      { id: 'opt-0', label: '3 goals', value: '3', correct: true },
      { id: 'opt-1', label: '5 goals', value: '5', correct: false },
    ],
  };
  const { secret, client } = projectRound(numeric, 1);
  assert.equal(secret.answer_value, '3');
  assert.equal(client.options[0].label, '3 goals');
  assert.equal(client.options[0].value, '3');
});
