import test from 'node:test';
import assert from 'node:assert/strict';
import { stackIsUp, playerClient, serverClient, callFunction } from './helpers.js';

const up = await stackIsUp();
const skip = up ? false : 'the local Supabase stack is not running';

/** A started one-round room. */
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

test('a ten-round room plan is all identify rounds', { skip }, async () => {
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
  assert.equal(templates.filter((t) => t === 'identify').length, 10);
  assert.equal(templates.filter((t) => t === 'stat_value').length, 0);
  assert.ok(plan.plan.every((round) => round.client.clue_family));
});

test('the on-demand round shows one clue and names the family', { skip }, async () => {
  const { room, guest, round } = await oneRoundRoom();
  const { data, error } = await guest.client.rpc('current_round', {
    p_room_id: room.id, p_on_demand: true,
  });
  assert.equal(error, null, error?.message);
  assert.equal(data.round.clue_index, 0);
  assert.equal(data.round.clue_total, round.clues.length);
  assert.ok(data.round.clue_family);
  assert.equal(data.round.reveal_schedule, undefined);
  assert.equal(data.round.clues.filter((c) => c.value !== null).length, 1);
});

test('reveal_clue advances only the caller', { skip }, async () => {
  const { room, host, guest } = await oneRoundRoom();
  const reveal = await guest.client.rpc('reveal_clue', {
    p_room_id: room.id, p_round_number: 1, p_clue_index: 0,
  });
  assert.equal(reveal.error, null, reveal.error?.message);
  assert.equal(reveal.data.clue_index, 1);
  assert.equal(reveal.data.clues.filter((c) => c.value !== null).length, 2);

  const hostView = await host.client.rpc('current_round', {
    p_room_id: room.id, p_on_demand: true,
  });
  assert.equal(hostView.data.round.clue_index, 0);

  const stale = await guest.client.rpc('reveal_clue', {
    p_room_id: room.id, p_round_number: 1, p_clue_index: 0,
  });
  assert.equal(stale.data.clue_index, 1, 'a stale tap must not advance');
});

test('reveal_clue refuses a closed round', { skip }, async () => {
  const { room, guest, server } = await oneRoundRoom();
  await server.from('rounds')
    .update({ deadline_at: new Date(Date.now() - 1000).toISOString() })
    .eq('room_id', room.id);
  const late = await guest.client.rpc('reveal_clue', {
    p_room_id: room.id, p_round_number: 1, p_clue_index: 0,
  });
  assert.ok(late.error, 'a reveal after the deadline must be refused');
});

test('submit-answer on demand scores the clue index', { skip }, async () => {
  const { room, host, guest, round } = await oneRoundRoom();

  const immediate = await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: round.options[0].value, on_demand: true,
  }, guest.accessToken);
  assert.equal(immediate.status, 200, JSON.stringify(immediate.body));
  assert.equal(immediate.body.stage, 1);

  for (let i = 0; i < 2; i++) {
    const reveal = await host.client.rpc('reveal_clue', {
      p_room_id: room.id, p_round_number: 1, p_clue_index: i,
    });
    assert.equal(reveal.error, null, reveal.error?.message);
  }
  const late = await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: round.options[0].value, on_demand: true,
  }, host.accessToken);
  assert.equal(late.status, 200, JSON.stringify(late.body));
  assert.equal(late.body.stage, 3);
});

test('the old client shape still gets the timed ladder', { skip }, async () => {
  const { room, host, guest, server } = await oneRoundRoom();
  const { data, error } = await guest.client.rpc('current_round', { p_room_id: room.id });
  assert.equal(error, null, error?.message);
  assert.ok(Array.isArray(data.round.reveal_schedule));
  assert.equal(data.round.clues.filter((c) => c.value !== null).length, data.round.clues.length);

  await server.from('rounds')
    .update({ started_at: new Date(Date.now() - 10000).toISOString() })
    .eq('room_id', room.id);
  const timed = await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: data.round.options[0].value,
  }, host.accessToken);
  assert.equal(timed.status, 200, JSON.stringify(timed.body));
  assert.ok(timed.body.stage >= 2, 'the timed client must get the elapsed stage');
});

test('round_result carries the family, the total, and the response time', { skip }, async () => {
  const { room, host, guest, server, round } = await oneRoundRoom();
  await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: round.options[0].value, on_demand: true,
  }, guest.accessToken);
  await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: round.options[0].value, on_demand: true,
  }, host.accessToken);

  const result = await guest.client.rpc('round_result', {
    p_room_id: room.id, p_round_number: 1,
  });
  assert.equal(result.error, null, result.error?.message);
  assert.ok(result.data.clue_family);
  assert.equal(result.data.clue_total, round.clues.length);
  assert.equal(result.data.my_answer.stage, 1);
  assert.equal(typeof result.data.my_answer.response_time_ms, 'number');
});

test('a rematch deletes progress rows and the next game starts at zero', { skip }, async () => {
  const { room, host, guest, server, round } = await oneRoundRoom();
  await guest.client.rpc('reveal_clue', {
    p_room_id: room.id, p_round_number: 1, p_clue_index: 0,
  });

  const { data: oldRound } = await server.from('rounds')
    .select('id').eq('room_id', room.id).eq('round_number', 1).single();

  await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: round.options[0].value, on_demand: true,
  }, guest.accessToken);
  await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: round.options[0].value, on_demand: true,
  }, host.accessToken);

  // The poll is what closes the round. Without it the room is still
  // round_active, and reset_room refuses a game that is not final.
  const closed = await guest.client.rpc('current_round', {
    p_room_id: room.id, p_on_demand: true,
  });
  assert.equal(closed.error, null, closed.error?.message);
  assert.equal(closed.data.status, 'final');

  const reset = await host.client.rpc('reset_room', { p_room_id: room.id });
  assert.equal(reset.error, null, reset.error?.message);

  const { data: progress } = await server.from('round_progress')
    .select('*').eq('round_id', oldRound.id);
  assert.equal(progress.length, 0, 'a rematch must cascade the progress rows');

  const restarted = await callFunction('start-room', { room_id: room.id }, host.accessToken);
  assert.equal(restarted.status, 200, JSON.stringify(restarted.body));
  const view = await guest.client.rpc('current_round', {
    p_room_id: room.id, p_on_demand: true,
  });
  assert.equal(view.data.round.clue_index, 0);
});

test('a steal on an on-demand round copies the target stage and half points', { skip }, async () => {
  const { room, host, guest, server, round } = await oneRoundRoom();
  const { data: secret } = await server.from('round_secrets')
    .select('*').eq('round_id', round.id).single();

  const steal = await host.client.rpc('use_room_effect', {
    p_room_id: room.id, p_round_number: 1, p_kind: 'steal', p_target_user_id: guest.userId,
  });
  assert.equal(steal.error, null, steal.error?.message);

  for (let i = 0; i < 2; i++) {
    const reveal = await guest.client.rpc('reveal_clue', {
      p_room_id: room.id, p_round_number: 1, p_clue_index: i,
    });
    assert.equal(reveal.error, null, reveal.error?.message);
  }
  const answer = await callFunction('submit-answer', {
    room_id: room.id, round_number: 1, guessed_answer: secret.answer_value, on_demand: true,
  }, guest.accessToken);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.equal(answer.body.stage, 3);

  const result = await host.client.rpc('round_result', {
    p_room_id: room.id, p_round_number: 1,
  });
  assert.equal(result.error, null, result.error?.message);
  assert.equal(result.data.my_answer.stage, 3);
  assert.equal(result.data.my_answer.points, Math.floor(answer.body.points / 2));
});
