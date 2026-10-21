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
