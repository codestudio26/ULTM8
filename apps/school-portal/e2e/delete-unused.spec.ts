import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Deleting in the portal (Decision 198), against the real API: the owner
 * deletes a lesson, an unused skill and an unused belt; a belt a student holds
 * and a style a student has a rank in are refused, with the reason shown.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // BJJ: White 0–2, Blue 0; Sam Lee at White 1; Armbar with one lesson
});

test.afterAll(cleanup);

test('the owner deletes a lesson, then the skill it used, and an unused belt', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/curriculum');
  await page.getByRole('button', { name: 'Delete Armbar from guard' }).click();
  let dialog = page.getByRole('dialog', { name: 'Delete Armbar from guard?' });
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Armbar from guard')).toHaveCount(0);

  await page.goto(`/disciplines/${s.disciplineId}`);
  await page.getByRole('button', { name: 'Delete Armbar' }).click();
  dialog = page.getByRole('dialog', { name: 'Delete Armbar?' });
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => db.skill.count({ where: { id: s.skillId } })).toBe(0);

  await page.getByRole('button', { name: 'Delete Blue' }).click();
  dialog = page.getByRole('dialog', { name: 'Delete Blue?' });
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('list', { name: 'Ladder' }).getByRole('listitem', { name: /Blue/ })).toHaveCount(0);
});

test('a belt a student holds, and a style a student has a rank in, are kept with the reason', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto(`/disciplines/${s.disciplineId}`);
  await page.getByRole('button', { name: 'Delete White' }).click();
  let dialog = page.getByRole('dialog', { name: 'Delete White?' });
  await expect(dialog.getByText(/hold this belt/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(dialog.getByText(/can't be deleted/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  await page.goto('/disciplines');
  await page.getByRole('button', { name: 'Delete BJJ' }).click();
  dialog = page.getByRole('dialog', { name: 'Delete BJJ?' });
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(dialog.getByText(/has a rank in this style/)).toBeVisible();
  expect(await db.discipline.count({ where: { id: s.disciplineId } })).toBe(1);
});
