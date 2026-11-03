import { expect, test } from '@playwright/test';
import { randomUUID } from 'crypto';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Branch Staff get the coach screens (Phase 7; Decisions 181, 183, 184):
 * the dashboard and the Grading Board when they have grading permission.
 * They no longer invite coaches: only the main owner adds people (Decision
 * 423 item 10).
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // BJJ; Sam Lee ready to grade
});

test.afterAll(async () => {
  await cleanup();
});

test('Branch Staff with grading permission land on the dashboard and use the board', async ({ page }) => {
  const staff = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId }]);
  await db.gradingPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: staff.id, disciplineId: s.disciplineId } });
  await signIn(page, staff.token);
  await page.goto('/');
  await expect(page).toHaveURL(/\/coach$/);
  await expect(page.getByText('Branch Staff', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Grading' }).getByText('1 ready to grade')).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Invite coaches' })).toHaveCount(0);

  await page.getByRole('navigation').getByRole('link', { name: 'Grading', exact: true }).click();
  await expect(page.getByRole('listitem', { name: s.student.name })).toBeVisible();
});

test('Branch Staff no longer invite coaches: the old page says only the main owner adds people (Decision 423 item 10)', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const staff = await addPerson('Bo', 'Front', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  await db.staffPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: staff.id, canSeeStaffList: true, canManageClasses: true } });
  await signIn(page, staff.token);
  await page.goto('/coach');
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Invite coaches' })).toHaveCount(0);
  await page.goto('/coach-invites');
  await expect(page.getByText("Only the account's main owner can add or remove people.")).toBeVisible();
  await expect(page.getByLabel("Coach's email")).toHaveCount(0);
  expect(await db.coachInvite.count({ where: { schoolId: s.schoolId } })).toBe(0);
});