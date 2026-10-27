import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 364 — a School Owner closes their own School from the School page,
 * with the School's name and their passcode, the same way a Franchise Owner
 * closes a Franchise (Decision 352). Against the real API and Postgres.
 */
let s: GradingSchool;

/** bcrypt of PASSCODE, so the School Owner can pass the passcode check. */
const PASSCODE = '246810';
const PASSCODE_HASH = '$2a$04$QgvRMStkWKUF3MhKA6PCqOyLa9KyeaFbUN70R/Q3Hdw0o0DANsmIy';

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await db.user.update({ where: { id: s.ownerId }, data: { passcodeHash: PASSCODE_HASH } });
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

test('Decision 364 — the School Owner closes the School with its name and their passcode', async ({ page }) => {
  const name = (await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).name;
  await page.goto('/school');
  await expect(page.getByText("every student's membership subscription")).toBeVisible();
  await page.getByRole('button', { name: 'Close School' }).click();
  const dialog = page.getByRole('dialog', { name: 'Close this School?' });
  const submit = dialog.getByRole('button', { name: 'Close School' });

  await dialog.getByLabel(`Type "${name}" to confirm`).fill('not the name');
  await expect(submit).toBeDisabled();
  await dialog.getByLabel(`Type "${name}" to confirm`).fill(name);
  await dialog.getByLabel('Your 6-digit passcode').fill('111111');
  await submit.click();
  await expect(dialog).toContainText('Incorrect passcode.');
  expect((await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).archivedAt).toBeNull();

  await dialog.getByLabel('Your 6-digit passcode').fill(PASSCODE);
  await submit.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'This School is closed' })).toBeVisible();
  await expect(page.getByTestId('school-closed-notice')).toContainText('only ULTM8 support can reopen it');
  await expect(page.getByRole('button', { name: 'Close School' })).toHaveCount(0);
  const after = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(after.archivedAt).not.toBeNull();
  expect(after.purgeAt).not.toBeNull();
});
