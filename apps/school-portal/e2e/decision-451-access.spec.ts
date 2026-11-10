import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn } from './fixtures';

/**
 * Decision 451:
 * - item 2 (R-1): a coach or Branch Staff member whose access is paused lands
 *   on "Access paused" after signing in, not on "Create your School".
 * - item 14: a member's birth date is owner-only; a coach with "Manage
 *   students" sees it greyed out with the reason.
 */
test.afterAll(async () => {
  await cleanup();
});

test('paused staff are told their access is paused, not offered to create a School', async ({ page }) => {
  const s = await seedGradingSchool();
  const paused = await addPerson('Paula', 'Paused');
  const now = new Date();
  await db.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: paused.id, schoolId: s.schoolId, revokedAt: now, pausedAt: now } });
  await signIn(page, paused.token);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Access paused' })).toBeVisible();
  await expect(page.getByText('Your access to this School has been paused. Please contact the School owner.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  await expect(page.getByText('Create your School')).toHaveCount(0);
});

test('someone with no School still lands on Create your School', async ({ page }) => {
  const nobody = await addPerson('Nora', 'Nobody');
  await signIn(page, nobody.token);
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("a coach with \"Manage students\" can't change a member's birth date", async ({ page }) => {
  const s = await seedGradingSchool();
  const coach = await addPerson('Cora', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await db.staffPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: coach.id, canManageStudentsAsCoach: true } });
  await signIn(page, coach.token);
  await page.goto(`/students/${s.newStudent.id}/edit`);
  await expect(page.getByLabel('Date of birth')).toBeDisabled();
  await expect(page.getByText("Only the School owner can change a member's birth date.")).toBeVisible();
  await expect(page.getByLabel('Join date')).toBeEnabled();
});
