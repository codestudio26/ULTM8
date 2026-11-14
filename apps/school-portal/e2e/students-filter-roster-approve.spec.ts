import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';
import { pickOption } from './team-helpers';

/**
 * Decision 462, Students area: item 2 (the Attendance and Growth branch
 * filter keeps every Branch in its list after one is picked), item 3 (a
 * roster is deleted through the standard delete pop-up) and item 23 (on the
 * Students list's freeze requests, Approve is the green main button).
 */
let s: GradingSchool;
const DAY = 86_400_000;

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.rosterMember.deleteMany({ where: { roster: where } });
  await db.roster.deleteMany({ where });
  await db.membershipFreeze.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

/** The names a branch drop-down offers, read with the list open. */
async function branchOptions(page: Page) {
  await page.getByRole('combobox', { name: 'Branch', exact: true }).click();
  const list = page.getByRole('listbox', { name: 'Branch', exact: true });
  await expect(list).toBeVisible();
  const names = await list.getByRole('option').allInnerTexts();
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  return names.map((n) => n.replace('✓', '').trim());
}

for (const [tab, path, ready] of [
  ['Attendance', '/students/attendance', 'attendance-period'],
  ['Growth', '/students/growth', 'growth-period'],
] as const) {
  test.describe(`Students → ${tab}: the branch filter`, () => {
    test('keeps every Branch in the list after one is picked (owner)', async ({ page }) => {
      await addBranch(s, 'North');
      await addBranch(s, 'South');
      await addBranch(s, 'West');
      await signIn(page, s.ownerToken);
      await page.goto(path);
      await expect(page.getByTestId(ready)).toBeVisible();
      expect(await branchOptions(page)).toEqual(['All your branches', 'North', 'South', 'West']);

      await pickOption(page, 'Branch', 'North');
      await expect(page.getByTestId(ready)).toBeVisible();
      // The bug: only "All your branches" and North were left.
      expect(await branchOptions(page)).toEqual(['All your branches', 'North', 'South', 'West']);
      // Another Branch can be picked straight away.
      await pickOption(page, 'Branch', 'South');
      await expect(page.getByTestId(ready)).toBeVisible();
      expect(await branchOptions(page)).toEqual(['All your branches', 'North', 'South', 'West']);
    });

    test("Branch Staff keep their own Branches after picking one, and still don't see the others", async ({ page }) => {
      const north = await addBranch(s, 'North');
      const south = await addBranch(s, 'South');
      await addBranch(s, 'West');
      const staff = await addPerson('Bea', 'Staff', [
        { role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id },
        { role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: south.id },
      ]);
      await db.staffPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: staff.id, canSeeAttendanceStats: true } });
      await signIn(page, staff.token);
      await page.goto(path);
      await expect(page.getByTestId(ready)).toBeVisible();
      expect(await branchOptions(page)).toEqual(['All your branches', 'North', 'South']);

      await pickOption(page, 'Branch', 'South');
      await expect(page.getByTestId(ready)).toBeVisible();
      expect(await branchOptions(page)).toEqual(['All your branches', 'North', 'South']);
    });
  });
}

test('Rosters: Delete asks in the standard delete pop-up, not in the row', async ({ page }) => {
  await db.roster.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'Competition team' } });
  await db.roster.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'Kids squad' } });
  await signIn(page, s.ownerToken);
  await page.goto('/students/rosters');
  const row = page.locator('.u8st-roster').filter({ has: page.getByLabel('Name of Competition team') });
  await expect(row).toBeVisible();

  // Cancel keeps the roster; nothing is asked inside the row.
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete Competition team?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Its students stay at the School; only the list goes.');
  await expect(row.getByText('Delete this roster?')).toHaveCount(0);
  await expect(row.getByRole('button')).toHaveText(['Show students', 'Rename', 'Delete']);
  // The house band: Cancel first, the red Delete last.
  await expect(dialog.locator('.ultm8-modal__actions').getByRole('button')).toHaveText(['Cancel', 'Delete']);
  await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toHaveClass(/ultm8-btn--danger/);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await db.roster.count({ where: { schoolId: s.schoolId } })).toBe(2);

  // Delete removes only that roster.
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Name of Competition team')).toHaveCount(0);
  await expect(page.getByLabel('Name of Kids squad')).toBeVisible();
  expect(await db.roster.findMany({ where: { schoolId: s.schoolId }, select: { name: true } })).toEqual([{ name: 'Kids squad' }]);
});

test('Students list → Freeze requests: Approve is the green main button, Decline keeps the outlined look', async ({ page }) => {
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, title: 'Four weeks', type: 'WEEKLY_PASS', price: 4000, currency: 'GBP', expiryDurationDays: 28 },
  });
  const m = await db.membership.create({
    data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: plan.id, schoolId: s.schoolId, frequency: 'ONE_TIME', expiryDate: new Date(Date.now() + 20 * DAY) },
  });
  const today = new Date().toISOString().slice(0, 10);
  await db.membershipFreeze.create({
    data: {
      id: randomUUID(), membershipId: m.id, schoolId: s.schoolId, studentId: s.student.id, status: 'REQUESTED', requestedById: s.student.id,
      startsAt: new Date(`${today}T00:00:00.000Z`), endsAt: new Date(Date.now() + 8 * DAY),
    },
  });
  await signIn(page, s.ownerToken);
  await page.goto('/students');
  const requests = page.getByTestId('freeze-requests');
  const approve = requests.getByRole('button', { name: 'Approve' });
  const decline = requests.getByRole('button', { name: 'Decline' });
  await expect(approve).toHaveClass(/ultm8-btn--primary/);
  await expect(approve).toHaveClass(/u8b-pill--primary/);
  await expect(decline).toHaveClass(/ultm8-btn--secondary/);
  await expect(decline).not.toHaveClass(/u8b-pill--primary/);
  const look = (el: Element) => getComputedStyle(el).backgroundColor;
  const [green, plain] = [await approve.evaluate(look), await decline.evaluate(look)];
  expect(green).not.toBe(plain);
  // Green: the new look's main-button fill, its green channel the strongest.
  const [r, g, b] = green.match(/\d+/g)!.map(Number);
  expect(g).toBeGreaterThan(r);
  expect(g).toBeGreaterThan(b);
  // Still a pair on one line, the same height.
  const [a, d] = [await approve.boundingBox(), await decline.boundingBox()];
  expect(Math.abs(a!.height - d!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(a!.y - d!.y)).toBeLessThanOrEqual(1);

  // Approve still approves.
  await approve.click();
  await expect(requests).toHaveCount(0);
  expect((await db.membershipFreeze.findFirst({ where: { schoolId: s.schoolId } }))?.status).not.toBe('REQUESTED');
});
