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
