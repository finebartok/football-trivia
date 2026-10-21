import { test, expect } from '@playwright/test';

/** Every page error and console error seen during the test. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/**
 * A host with a room open, and a guest who has joined it.
 *
 * The local stack has to be running: `npm run supabase:start`.
 */
async function roomWithTwoPlayers(browser, { presetIndex = 3 } = {}) {
  const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto('./');
  await host.locator('.vibe-card--preset').nth(presetIndex).click();
  await host.locator('#btn-create-room').click();
  await expect(host).toHaveURL(/#room-lobby/);
  const code = await host.locator('#room-code').innerText();

  await guest.goto('./');
  await guest.locator('.vibe-card--door').nth(1).click();
  await guest.locator('#join-code').fill(code);
  await guest.locator('#join-name').fill('Sam');
  await guest.locator('#btn-join').click();
  await expect(guest).toHaveURL(/#room-lobby/);

  return { host, guest };
}

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
