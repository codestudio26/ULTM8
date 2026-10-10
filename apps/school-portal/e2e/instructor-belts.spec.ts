import { expect, test } from '@playwright/test';
import { randomUUID } from 'crypto';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Instructors' own belts (Decisions 108, 188), against the real API: an
 * instructor chooses their belt on "My belts"; the owner verifies it, or
 * corrects it, on the Instructors page.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // BJJ: White 0–2, Blue 0
});

test.afterAll(async () => {
  await cleanup();
});

test('an instructor chooses their belt; it shows "Not verified"', async ({ page }) => {
  const coach = await addPerson('Cody', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await signIn(page, coach.token);
  await page.goto('/coach');
  await page.getByRole('link', { name: 'My belts' }).click();
  await page.getByLabel('Your belt in BJJ').selectOption({ label: 'White 1' });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved. The School owner will verify it.')).toBeVisible();
  await expect(page.getByText('Not verified')).toBeVisible();
  const row = await db.instructorBelt.findFirstOrThrow({ where: { userId: coach.id } });
  expect(row).toMatchObject({ stripeTierId: s.rung['White 1'].id, verificationStatus: 'UNVERIFIED' });
});

test('the owner verifies an instructor\'s belt, then corrects it', async ({ page }) => {
  const coach = await addPerson('Cody', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await addPerson('Quinn', 'Quiet', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await db.instructorBelt.create({
    data: { id: randomUUID(), schoolId: s.schoolId, userId: coach.id, disciplineId: s.disciplineId, rankId: s.rung['White 1'].rankId, stripeTierId: s.rung['White 1'].id },
  });
  await signIn(page, s.ownerToken);
  await page.goto('/instructors');
  const section = page.locator('.ultm8-field', { has: page.getByRole('heading', { name: "Instructors' belts" }) });
  await expect(section.getByRole('row', { name: /Cody Coach BJJ White 1 Not verified/ })).toBeVisible();
  await expect(section.getByText('Not chosen yet: Quinn Quiet.')).toBeVisible();

  await section.getByRole('button', { name: "Verify Cody Coach's BJJ belt" }).click();
  await expect(section.getByRole('row', { name: /Cody Coach BJJ White 1 Verified/ })).toBeVisible();

  await section.getByRole('button', { name: "Correct Cody Coach's BJJ belt" }).click();
  const dialog = page.getByRole('dialog', { name: "Cody Coach's BJJ belt" });
  await dialog.getByLabel('Belt').selectOption({ label: 'Blue 0' });
  await dialog.getByRole('button', { name: 'Save and verify' }).click();
  await expect(dialog).toBeHidden();
  await expect(section.getByRole('row', { name: /Cody Coach BJJ Blue 0 Verified/ })).toBeVisible();
});

test('Branch Staff who aren\'t instructors have no "My belts"', async ({ page }) => {
  const staff = await addPerson('Bea', 'Staff', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId }]);
  await signIn(page, staff.token);
  await page.goto('/coach');
  await expect(page.getByRole('link', { name: 'Grading Board' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'My belts' })).toHaveCount(0);
});
