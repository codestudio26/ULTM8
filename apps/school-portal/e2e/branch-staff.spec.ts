import { expect, test } from '@playwright/test';
import { randomUUID } from 'crypto';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Branch Staff get the coach screens (Phase 7; Decisions 181, 183, 184):
 * the dashboard, the Grading Board when they have grading permission, and
 * "Invite coaches" for their own branches when the owner allows it.
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

  await page.getByRole('navigation').getByRole('link', { name: 'Grading Board' }).click();
  await expect(page.getByRole('listitem', { name: s.student.name })).toBeVisible();
});

test('with "Can invite coaches" they invite to their own branches only', async ({ page }) => {
  const north = await addBranch(s, 'North');
  await addBranch(s, 'South');
  const staff = await addPerson('Bo', 'Front', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  await db.staffPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: staff.id, canInviteCoaches: true } });
  await signIn(page, staff.token);
  await page.goto('/coach');
  await page.getByRole('navigation').getByRole('link', { name: 'Invite coaches' }).click();
  await expect(page.getByRole('heading', { name: 'Invite coaches' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Who can invite coaches' })).toHaveCount(0);

  const branch = page.getByLabel('Branch');
  await expect(branch.locator('option')).toHaveText(['Select a branch…', 'North']);
  await page.getByLabel("Coach's email").fill('north.coach@example.test');
  await branch.selectOption({ label: 'North' });
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByRole('row', { name: /north\.coach@example\.test/ }).getByText('Waiting')).toBeVisible();
  expect(await db.coachInvite.findFirstOrThrow({ where: { schoolId: s.schoolId } })).toMatchObject({ branchId: north.id, invitedById: staff.id });
});
