import { expect, test } from '@playwright/test';
import { cleanup, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * A stray click outside a form popup used to close it and throw away what was
 * typed. Now a click outside (or Escape) closes it only while nothing has been
 * typed; after that only its own buttons close it. Shared `Modal`, so this holds
 * for every popup; Add branch is the one reported.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterAll(async () => {
  await cleanup();
});

/** A click on the dimmed area around the popup, well clear of the dialog. */
async function clickOutside(page: import('@playwright/test').Page) {
  await page.mouse.click(5, 5);
}

test('an empty popup still closes on a click outside, or on Escape', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/branches');

  await page.getByRole('button', { name: 'Add branch' }).click();
  await expect(page.getByRole('dialog', { name: 'Add branch' })).toBeVisible();
  await clickOutside(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Add branch' }).click();
  await expect(page.getByRole('dialog', { name: 'Add branch' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('once something is typed, a click outside or Escape keeps the popup and what was typed', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/branches');

  await page.getByRole('button', { name: 'Add branch' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add branch' });
  await dialog.getByLabel('Branch name').fill('Half-typed Dojo');

  await clickOutside(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Branch name')).toHaveValue('Half-typed Dojo');

  // Its own Cancel still closes it.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('selecting text inside and letting go outside does not close the popup', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/branches');

  await page.getByRole('button', { name: 'Add branch' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add branch' });
  const box = (await dialog.getByLabel('Branch name').boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await expect(dialog).toBeVisible();
});
