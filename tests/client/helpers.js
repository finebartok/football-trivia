import { expect } from '@playwright/test';

/**
 * A host with a room open, and a guest who has joined it.
 *
 * The local stack has to be running: `npm run supabase:start`.
 */
export async function roomWithTwoPlayers(browser, { presetIndex = 3, setup } = {}) {
  const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  // Anything the test needs in the page has to be there before the first
  // navigation, not after it.
  if (setup) await host.addInitScript(setup);

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

  return { host, guest, code };
}
