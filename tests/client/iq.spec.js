import { test, expect } from '@playwright/test';
import { roomWithTwoPlayers } from './helpers.js';

const IQ_LABELS = ['Club in a season', 'Teammate', 'Most in the pool', 'Stat range'];

const pickIq = () => localStorage.setItem('football-trivia-mode', 'football_iq');

test('a fresh session starts in guess-the-player and can switch to Football IQ', async ({ page }) => {
  await page.goto('./');

  await expect(page.locator('#mode-guess')).toHaveClass(/is-active/);
  await expect(page.locator('#mode-iq')).not.toHaveClass(/is-active/);

  await page.locator('#mode-iq').click();
  await expect(page.locator('#mode-iq')).toHaveClass(/is-active/);
  await expect(page.locator('#mode-guess')).not.toHaveClass(/is-active/);
  expect(await page.evaluate(() => localStorage.getItem('football-trivia-mode'))).toBe('football_iq');
});

test('a solo Football IQ quiz shows a format round and a format reveal', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(pickIq);

  await page.goto('./');
  await page.locator('.vibe-card--preset').first().click();
  await expect(page.locator('#lobby-mode')).toContainText('Football IQ');
  await page.locator('#btn-start').click();
  await expect(page).toHaveURL(/#round/);

  await expect(page.locator('#round-format')).toHaveText(new RegExp(IQ_LABELS.join('|')));
  await expect(page.locator('.round-prompt')).not.toHaveText('Who is this?');

  await page.locator('.option').first().click();
  await expect(page).toHaveURL(/#reveal/);
  await expect(page.locator('#iq-reveal')).toBeVisible();

  expect(errors).toEqual([]);
});

test('a Football IQ room carries its mode to the guest and reveals its format', async ({ browser }) => {
  const { host, guest } = await roomWithTwoPlayers(browser, {
    presetIndex: 0,
    setup: pickIq,
  });

  await expect(host.locator('#room-mode')).toHaveText('Football IQ');
  await expect(guest.locator('#room-mode')).toHaveText('Football IQ');

  await host.locator('#btn-start').click();
  await expect(host).toHaveURL(/#round/);
  await expect(host.locator('#round-format')).toHaveText(new RegExp(IQ_LABELS.join('|')));

  await host.locator('.option').first().click();
  await expect(host).toHaveURL(/#reveal/);

  await guest.locator('.option').first().click();
  await expect(guest).toHaveURL(/#reveal/);
  await expect(guest.locator('#iq-reveal')).toBeVisible({ timeout: 15000 });
});
