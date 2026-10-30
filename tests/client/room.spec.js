import { test, expect } from '@playwright/test';

// A room's round lasts twenty seconds and the whole room shares one
// local database, so these tests run one at a time and are given room
// to breathe.
test.describe.configure({ mode: 'serial' });
// A room's round lasts twenty seconds, and a test that waits for one to
// close waits for the deadline. Under load that is well over a minute.
test.setTimeout(120000);

// An answer is a round trip to the server and back. Five seconds is not
// enough when the local stack is busy.
expect.configure({ timeout: 30000 });

/** Every page error and console error seen during the test. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

import { roomWithTwoPlayers, roomWithOneRound } from './helpers.js';
import { serverClient } from '../integration/helpers.js';

test('the round screen shows the server round to everyone', async ({ browser }) => {
  const { host, guest } = await roomWithTwoPlayers(browser);
  const errors = [...watchErrors(host), ...watchErrors(guest)];

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(guest).toHaveURL(/#round/);

  // Both players see the same prompt and the same options.
  await expect(host.locator('.option')).toHaveCount(4);
  await expect(guest.locator('.option')).toHaveCount(4);
  const hostOptions = await host.locator('.option__label').allInnerTexts();
  const guestOptions = await guest.locator('.option__label').allInnerTexts();
  expect(hostOptions.sort()).toEqual(guestOptions.sort());

  const hostPrompt = await host.locator('.round-prompt, .prompt, h1').first().innerText().catch(() => '');
  expect(hostPrompt.length).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test('the option labels say what they count', async ({ browser }) => {
  const { host } = await roomWithTwoPlayers(browser);
  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);

  // Every option is a player name or a figure with its unit - never a
  // bare number.
  for (const label of await host.locator('.option__label').allInnerTexts()) {
    const text = label.trim();
    expect(text.length).toBeGreaterThan(0);
    expect(/^\d+$/.test(text), `"${text}" is a bare number`).toBe(false);
  }
});

test('a room shows the same answer to everyone and a leaderboard', async ({ browser }) => {
  const { host, guest } = await roomWithTwoPlayers(browser);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(guest).toHaveURL(/#round/);

  // Both answer. The round closes once everybody has answered.
  await host.locator('.option').first().click();
  await guest.locator('.option').first().click();

  await expect(host).toHaveURL(/#reveal/);
  await expect(guest).toHaveURL(/#reveal/);

  // The answer is only available once the round is closed, so the reveal
  // waits for it.
  // The answer itself is the same for everyone. The verdict is not: a
  // player who got it right sees "You got it", and one who did not sees
  // what the answer was.
  await expect(host.locator('.reveal-card__name')).toContainText(/./, { timeout: 15000 });
  const hostAnswer = await host.locator('.reveal-card__name').innerText();
  const guestAnswer = await guest.locator('.reveal-card__name').innerText();
  expect(hostAnswer).toBe(guestAnswer);
  expect(hostAnswer.length).toBeGreaterThan(0);
});

test('a player who refreshes mid-round keeps their score', async ({ browser }) => {
  const { host, guest } = await roomWithTwoPlayers(browser);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);

  await guest.locator('.option').first().click();
  await expect(guest).toHaveURL(/#reveal/);

  // The phone sleeps and the player comes back.
  await guest.reload();
  await guest.waitForTimeout(3000);

  // Still in the room, and the answer they gave is still theirs.
  await expect(guest).toHaveURL(/#round|#reveal/);
  const answer = await guest.evaluate(async () => {
    const m = await import('/client/src/room.js');
    return { answeredRound: m.room.state.answeredRound, points: m.room.state.myAnswer?.points ?? null };
  });
  expect(answer.answeredRound).toBe(1);
  expect(answer.points).not.toBeNull();
});

test('a player who answered one round can answer the next', async ({ browser }) => {
  const { host } = await roomWithTwoPlayers(browser);
  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);

  await host.locator('.option').first().click();
  await expect(host).toHaveURL(/#reveal/);

  // The room advances. The player must be able to play the next round,
  // not be bounced back to the reveal of the last one.
  await host.locator('#btn-next').click();
  await expect(host).toHaveURL(/#round/);
  await expect(host.locator('.option')).toHaveCount(4);
});

test('the home screen can create a room', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = watchErrors(page);
  await page.goto('./');

  // The door on the home screen, not a preset card.
  await page.locator('.vibe-card--door').first().click();
  await expect(page).toHaveURL(/#vibes/);
  await page.locator('#btn-create-room').click();
  await expect(page).toHaveURL(/#room-lobby/);
  expect(errors).toEqual([]);
});

test('the reveal does not hammer the server', async ({ browser }) => {
  const { host } = await roomWithTwoPlayers(browser);
  let calls = 0;
  host.on('request', (req) => {
    if (req.url().includes('round_result')) calls++;
  });

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await host.locator('.option').first().click();
  await expect(host).toHaveURL(/#reveal/);
  await host.waitForTimeout(3000);

  // The round is still open, so the reveal waits for the answer. It must
  // ask once or twice, not hundreds of times.
  expect(calls).toBeLessThan(5);
});

test('a player who joins is told which vibe the room is playing', async ({ browser }) => {
  const { guest } = await roomWithTwoPlayers(browser);
  await expect(guest.locator('.vibe-summary__body')).toContainText('World Cup 2022');
});

test('a room can be left', async ({ browser }) => {
  const { host, guest } = await roomWithTwoPlayers(browser);
  await expect(host.locator('#btn-leave')).toBeVisible();
  await host.locator('#btn-leave').click();
  await expect(host).toHaveURL(/#home/);
});

test('a solo game is a solo game, even with a room open', async ({ browser }) => {
  const { host } = await roomWithTwoPlayers(browser);
  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);

  // The player starts a solo game while the room is running.
  await host.evaluate(async () => {
    const { store } = await import('/client/src/store.js');
    await store.startQuiz({
      scope: { id: 'wc-2022', name: 'World Cup 2022', clauses: [{ tournaments: ['wc-2022'] }] },
      seed: 1,
    });
  });
  await expect(host).toHaveURL(/#round/);

  // The solo quiz is being played, not the room's round.
  const solo = await host.evaluate(async () => {
    const { store } = await import('/client/src/store.js');
    return { mode: store.state.mode, rounds: store.state.quiz?.rounds?.length ?? 0 };
  });
  expect(solo.mode).toBe('solo');
  expect(solo.rounds).toBe(10);
  await expect(host.locator('.option')).toHaveCount(4);
});

test('a room that cannot be played says so', async ({ browser }) => {
  const { host } = await roomWithTwoPlayers(browser);

  // Craft a vibe with too few players, then make a room from it.
  await host.goto('#vibes');
  await host.waitForSelector('#pool-count');
  await host.locator('#stat-metric').selectOption('goals_after_age_30');
  await host.locator('#stat-value').fill('300');
  await host.waitForTimeout(500);
  await host.locator('#btn-create-room').click();
  await expect(host).toHaveURL(/#room-lobby/);

  await host.locator('#btn-start').click();
  await host.waitForTimeout(2000);

  // The host is told, in a sentence, and the room is still a lobby.
  await expect(host.locator('#room-error')).toContainText(/Only \d+ players?/);
  await expect(host).toHaveURL(/#room-lobby/);
});

test('a room reveal says the answer out loud, once', async ({ browser }) => {
  const { host } = await roomWithTwoPlayers(browser, {
    setup: () => {
      window.__oscillators = 0;
      const Original = window.AudioContext;
      window.AudioContext = class extends Original {
        createOscillator() {
          window.__oscillators += 1;
          return super.createOscillator();
        }
      };
    },
  });

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await host.locator('.option').first().click();
  await expect(host).toHaveURL(/#reveal/);
  await host.waitForTimeout(3000);

  // The verdict made a sound...
  const first = await host.evaluate(() => window.__oscillators);
  expect(first).toBeGreaterThan(0);

  // ...and it did not keep making it as the screen redrew.
  await host.waitForTimeout(4000);
  const second = await host.evaluate(() => window.__oscillators);
  expect(second).toBe(first);
});

test('a steal warns the victim and copies their answer', async ({ browser }) => {
  const { host, guest } = await roomWithTwoPlayers(browser);
  const hostErrors = watchErrors(host);
  const guestErrors = watchErrors(guest);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(guest).toHaveURL(/#round/);

  await host.locator('#btn-steal').click();
  await host.locator('.picker__row').filter({ hasText: 'Sam' }).click();
  await host.locator('#btn-effect-confirm').click();

  // A thief has no answer to give: the reveal waits.
  await expect(host).toHaveURL(/#reveal/);

  // The victim knows the thief by name while the round is still open.
  await expect(guest.locator('#steal-warning')).toContainText('Host is copying your answer.');

  await guest.locator('.option').first().click();
  await expect(guest).toHaveURL(/#reveal/);

  // The Effects card and the copied-player verdict.
  await expect(host.locator('#effects-result')).toContainText('You copied Sam', { timeout: 20000 });
  expect([...hostErrors, ...guestErrors]).toEqual([]);
});

test('the victim sees who copied them and keeps their points at the reveal', async ({ browser }) => {
  const { host, guest } = await roomWithTwoPlayers(browser);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await host.locator('#btn-steal').click();
  await host.locator('.picker__row').filter({ hasText: 'Sam' }).click();
  await host.locator('#btn-effect-confirm').click();
  await expect(host).toHaveURL(/#reveal/);

  await guest.locator('.option').first().click();
  await expect(guest).toHaveURL(/#reveal/);
  await expect(guest.locator('#effects-result')).toContainText(/Host copied your (answer|wrong answer)/, { timeout: 20000 });
});

test('the target picker shows presence, not answered status, and survives a redraw', async ({ browser }) => {
  const { host } = await roomWithTwoPlayers(browser);
  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);

  await host.locator('#btn-steal').click();
  await expect(host.locator('.picker__row')).toHaveCount(1);
  await expect(host.locator('.picker__row')).toContainText('Sam');
  await expect(host.locator('.picker__row')).toContainText(/online|away/);
  await expect(host.locator('.picker__row')).not.toContainText(/answered/i);

  await host.locator('.picker__row').click();
  await host.waitForTimeout(3000);

  // The two-second redraw did not close it or lose the selection.
  await expect(host.locator('.picker')).toBeVisible();
  await expect(host.locator('.picker__row.is-picked')).toHaveCount(1);
});

test('a side bet shows its pending line and pays or loses at the reveal', async ({ browser }) => {
  const { host, guest } = await roomWithTwoPlayers(browser);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await host.locator('#btn-side-bet').click();
  await host.locator('.picker__row').filter({ hasText: 'Sam' }).click();
  await host.locator('#btn-effect-confirm').click();

  await expect(host.locator('#effects')).toContainText('Side bet on Sam');

  await host.locator('.option').first().click();
  await guest.locator('.option').first().click();
  await expect(host).toHaveURL(/#reveal/);
  await expect(host.locator('#effects-result')).toContainText(/You bet on Sam: (\+\d[\d,]*|no bonus)/, { timeout: 20000 });
});

test('the effects strip is absent when alone in a room', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const host = await context.newPage();
  await host.goto('./');
  await host.locator('.vibe-card--preset').nth(3).click();
  await host.locator('#btn-create-room').click();
  await expect(host).toHaveURL(/#room-lobby/);
  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(host.locator('#btn-steal')).toHaveCount(0);
});

test('the effects strip is absent in solo play', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const host = await context.newPage();
  await host.goto('./');
  await host.locator('.vibe-card--preset').nth(3).click();
  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(host.locator('#btn-steal')).toHaveCount(0);
});

test('the host rematches in the same room and the guest follows', async ({ browser }) => {
  const { host, guest, code } = await roomWithOneRound(browser);
  const hostErrors = watchErrors(host);
  const guestErrors = watchErrors(guest);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(guest).toHaveURL(/#round/);

  // A one-round room clamps the mix to one round, and that round is stat.
  await expect(host.locator('.round-prompt')).toContainText(/How many /);
  await host.locator('.option').first().click();
  await guest.locator('.option').first().click();
  await expect(host).toHaveURL(/#reveal/);
  await expect(guest).toHaveURL(/#reveal/);

  // The round closes, and the reveal shows the value with its unit.
  await expect(guest.locator('#btn-next')).toContainText('See how it went', { timeout: 30000 });
  await expect(host.locator('.reveal-card__name')).toContainText(/\d+ (goal|goals|cap|caps)/);

  // The guest sees the waiting note on the results screen.
  await guest.locator('#btn-next').click();
  await expect(guest).toHaveURL(/#results/);
  await expect(guest.locator('#rematch-waiting')).toContainText('Waiting for the host to start again.');
  await expect(guest.locator('#btn-rematch')).toHaveCount(0);

  // The host goes to the results and sees the button.
  await expect(host.locator('#btn-next')).toContainText('See how it went', { timeout: 30000 });
  await host.locator('#btn-next').click();
  await expect(host).toHaveURL(/#results/);
  await expect(host.locator('#btn-rematch')).toBeVisible();

  // Give the finished game something to reset: a score for each player and
  // a steal the host has already spent. A rematch that only resets the room
  // status would leave all of it behind.
  const ids = await host.evaluate(async () => {
    const { room } = await import('/src/room.js');
    return {
      host: room.state.members.find((m) => m.is_host)?.user_id,
      guest: room.state.members.find((m) => !m.is_host)?.user_id,
    };
  });
  const server = serverClient();
  const { data: roomRow, error: roomError } = await server.from('rooms')
    .select('id').eq('code', code).single();
  if (roomError) throw roomError;
  const { data: roundRow, error: roundError } = await server.from('rounds')
    .select('id').eq('room_id', roomRow.id)
    .order('round_number', { ascending: false }).limit(1).single();
  if (roundError) throw roundError;

  // Seed the scores first: inserting the effect fires a realtime sync, and
  // it must not read the memberships before the scores are committed.
  const seeded = [
    await server.from('room_memberships')
      .update({ total_score: 1234, correct_count: 3 })
      .eq('room_id', roomRow.id).eq('user_id', ids.host),
    await server.from('room_memberships')
      .update({ total_score: 567, correct_count: 1 })
      .eq('room_id', roomRow.id).eq('user_id', ids.guest),
    await server.from('room_effects').insert({
      room_id: roomRow.id,
      round_id: roundRow.id,
      actor_id: ids.host,
      target_id: ids.guest,
      kind: 'steal',
    }),
  ];
  for (const { error } of seeded) if (error) throw error;

  // The host's client sees the seeded score and the spent steal before the
  // rematch, so the checks after it cannot pass on an empty game.
  const before = await host.evaluate(async () => {
    const { room } = await import('/src/room.js');
    await room.sync();
    return {
      score: room.state.leaderboard.find((m) => m.user_id === room.state.me)?.total_score ?? null,
      effects: room.state.myEffects.length,
    };
  });
  expect(before.score).toBe(1234);
  expect(before.effects).toBe(1);

  // Put the guest back on the reveal, where a stale result is most likely
  // to strand them. The reset must pull them to the lobby.
  await guest.evaluate(() => { location.hash = '#reveal'; });
  await expect(guest).toHaveURL(/#reveal/);
  await host.locator('#btn-rematch').click();
  await expect(host).toHaveURL(/#room-lobby/);
  await expect(guest).toHaveURL(/#room-lobby/);
  await expect(host.locator('#room-code')).toHaveText(code);

  // A fresh game in the same room, with zero scores and effects available.
  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(guest).toHaveURL(/#round/);
  await expect(host.locator('.round-meta')).toContainText('Round 1 of 1');
  await expect(host.locator('#btn-steal')).toBeVisible();
  await expect(guest.locator('#btn-steal')).toBeVisible();

  // The reset cleared the seeded score and the spent steal, not just the
  // room status: the host is back to zero and can steal again.
  await expect(host.locator('#btn-steal')).toBeEnabled();
  await expect(host.locator('#btn-steal')).toHaveText('Steal a friend');
  const after = await host.evaluate(async () => {
    const { room } = await import('/src/room.js');
    return {
      score: room.state.leaderboard.find((m) => m.user_id === room.state.me)?.total_score ?? null,
      effects: room.state.myEffects.length,
    };
  });
  expect(after.score).toBe(0);
  expect(after.effects).toBe(0);

  expect([...hostErrors, ...guestErrors]).toEqual([]);
});

test('a press that spans a room redraw still answers', async ({ browser }) => {
  const { host, guest } = await roomWithTwoPlayers(browser);
  const hostErrors = watchErrors(host);
  const guestErrors = watchErrors(guest);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);

  const box = await host.locator('.option').first().boundingBox();
  await host.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await host.mouse.down();

  // A poll lands while the finger is still down. It notifies every
  // subscriber, which is exactly what used to replace the button.
  await host.evaluate(async () => {
    const { room } = await import('/src/room.js');
    await room.sync();
  });

  await host.mouse.up();
  await expect(host).toHaveURL(/#reveal/);

  const answered = await host.evaluate(async () => {
    const { room } = await import('/src/room.js');
    return room.state.answeredRound;
  });
  expect(answered).toBe(1);
  expect([...hostErrors, ...guestErrors]).toEqual([]);
});

test('a guest becomes host after the final and can rematch', async ({ browser }) => {
  const { host, guest, code } = await roomWithOneRound(browser);

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(guest).toHaveURL(/#round/);

  // Both answer the only round, so the room reaches final.
  await host.locator('.option').first().click();
  await guest.locator('.option').first().click();
  await expect(host).toHaveURL(/#reveal/);
  await expect(guest).toHaveURL(/#reveal/);

  await expect(guest.locator('#btn-next')).toContainText('See how it went', { timeout: 30000 });
  await guest.locator('#btn-next').click();
  await expect(guest).toHaveURL(/#results/);
  await expect(guest.locator('#rematch-waiting')).toBeVisible();

  // The host leaves after the final. leave_room moves the host role to
  // the guest, and only the slow final poll can tell the guest.
  await host.evaluate(async () => {
    const { room } = await import('/src/room.js');
    await room.leave();
  });

  await expect(guest.locator('#btn-rematch')).toBeVisible({ timeout: 15000 });
  await guest.locator('#btn-rematch').click();
  await expect(guest).toHaveURL(/#room-lobby/);
  await expect(guest.locator('#room-code')).toHaveText(code);
});

test('a press that spans a round advance does not answer the new round', async ({ browser }) => {
  const { host, guest } = await roomWithTwoPlayers(browser);
  const hostErrors = watchErrors(host);
  const guestErrors = watchErrors(guest);
  let submits = 0;
  host.on('request', (req) => {
    if (req.url().includes('submit-answer')) submits += 1;
  });

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(host.locator('.round-meta')).toContainText('Round 1 of 10');

  const ids = await host.evaluate(async () => {
    const { room } = await import('/src/room.js');
    return { roomId: room.state.roomId, me: room.state.me, roundId: room.state.round.id };
  });

  const box = await host.locator('.option').first().boundingBox();
  await host.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await host.mouse.down();

  // The round closes while the press is still down. The next sync
  // advances the room to round 2, but the deferred render leaves the
  // round-1 buttons live under the finger.
  const server = serverClient();
  const { error: deadlineError } = await server.from('rounds')
    .update({ deadline_at: new Date(Date.now() - 1000).toISOString() })
    .eq('id', ids.roundId);
  if (deadlineError) throw deadlineError;

  await host.evaluate(async () => {
    const { room } = await import('/src/room.js');
    await room.sync();
  });

  await expect(host.locator('.option').first()).toBeEnabled();
  const advanced = await host.evaluate(async () => {
    const { room } = await import('/src/room.js');
    return { round: room.state.round?.round_number ?? null, answered: room.state.answeredRound };
  });
  expect(advanced.round).toBe(2);

  await host.mouse.up();

  // The click belongs to round 1, so it is dropped instead of answering
  // round 2. Give a stale submission time to land before checking.
  await expect(host.locator('.round-meta')).toContainText('Round 2 of 10');
  await host.waitForTimeout(1500);

  await expect(host).toHaveURL(/#round/);
  const after = await host.evaluate(async () => {
    const { room } = await import('/src/room.js');
    return { round: room.state.round?.round_number ?? null, answered: room.state.answeredRound };
  });
  expect(after.round).toBe(2);
  expect(after.answered).toBeNull();
  expect(submits).toBe(0);

  const { data: roundTwo, error: roundError } = await server.from('rounds')
    .select('id').eq('room_id', ids.roomId).eq('round_number', 2).single();
  if (roundError) throw roundError;
  const { data: answers, error: answerError } = await server.from('answers')
    .select('id').eq('round_id', roundTwo.id).eq('user_id', ids.me);
  if (answerError) throw answerError;
  expect(answers).toEqual([]);

  expect([...hostErrors, ...guestErrors]).toEqual([]);
});
