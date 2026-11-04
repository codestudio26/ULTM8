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

// Classes made here (Decision 425 Q1) aren't cleaned by the shared cleanup.
test.afterEach(async () => {
  await db.class.deleteMany({ where: { schoolId: s.schoolId } });
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
test("Branch Staff see their branch's classes this week, with roll call when they handle bookings (Decision 425 Q1, Q4)", async ({ page }) => {
  const north = await addBranch(s, 'North');
  const south = await addBranch(s, 'South');
  const staff = await addPerson('Bly', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);
  const mk = (title: string, branchId: string | null, days: number) =>
    db.class.create({ data: { id: randomUUID(), schoolId: s.schoolId, branchId, title, startDate: inDays(days), endDate: new Date(inDays(days).getTime() + 3_600_000) } });
  await mk('North tomorrow', north.id, 1);
  await mk('Whole-School Friday', null, 2);
  await mk('South tomorrow', south.id, 1);
  await mk('North next month', north.id, 30);
  await signIn(page, staff.token);
  await page.goto('/coach');

  const week = page.getByRole('region', { name: 'Classes at your branch this week' });
  const northRow = week.getByRole('listitem').filter({ hasText: 'North tomorrow' });
  await expect(northRow).toContainText('North');
  await expect(northRow).toContainText(/\d{1,2}:\d{2}/); // the start time
  await expect(northRow.getByRole('link', { name: 'Roll call' })).toBeVisible();
  await expect(week.getByRole('listitem').filter({ hasText: 'Whole-School Friday' })).toContainText('Whole School');
  await expect(week.getByText('South tomorrow')).toHaveCount(0);
  await expect(week.getByText('North next month')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'My classes' })).toHaveCount(0);

  // With "Handle bookings" off, the classes still show but with no links.
  await db.staffPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: staff.id, canManageBookings: false } });
  await page.reload();
  await expect(week.getByText('North tomorrow')).toBeVisible();
  await expect(week.getByRole('link')).toHaveCount(0);
});
