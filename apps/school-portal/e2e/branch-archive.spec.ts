import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 330 — "Close branch" shows what is still in use and moves it where
 * the owner picks; a Branch with history is kept for good. Decision 293 —
 * closed Branches are left out of Branch pickers, except the one a record
 * being edited already points at.
 */
let s: GradingSchool;
const branchIds: string[] = [];
const slotIds: string[] = [];
const classIds: string[] = [];

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterEach(async () => {
  await db.class.deleteMany({ where: { id: { in: classIds } } });
  await db.timetableSlot.deleteMany({ where: { id: { in: slotIds } } });
  await db.branch.deleteMany({ where: { id: { in: branchIds } } });
  branchIds.length = 0;
  slotIds.length = 0;
  classIds.length = 0;
});

test.afterAll(async () => {
  await cleanup();
});

async function mkBranch(name: string, archived = false) {
  const branch = await db.branch.create({
    data: { id: randomUUID(), schoolId: s.schoolId, name, ...(archived ? { archivedAt: new Date(), purgeAt: new Date(Date.now() + 90 * 86_400_000) } : {}) },
  });
  branchIds.push(branch.id);
  return branch;
}

test('Close branch asks first: Cancel leaves the Branch, closing an empty one sets it to be removed after 90 days', async ({ page }) => {
  await mkBranch('Riverside');
  await signIn(page, s.ownerToken);
  await page.goto('/branches');

  const openClose = async () => {
    await page.getByRole('button', { name: 'Actions for Riverside' }).click();
    await page.getByRole('menu', { name: 'Actions for Riverside' }).getByRole('menuitem', { name: 'Close branch' }).click();
  };

  await openClose();
  const dialog = page.getByRole('dialog', { name: 'Close Riverside?' });
  await expect(dialog.getByText('Nothing at this Branch is still in use, so nothing needs to move.')).toBeVisible();
  await expect(dialog.getByText(/removed for good after 90 days/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Riverside', exact: true })).toBeVisible();

  await openClose();
  await page.getByRole('dialog', { name: 'Close Riverside?' }).getByRole('button', { name: 'Close branch' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Riverside', exact: true })).toHaveCount(0);
  await expect(page.getByText('Show closed (1)')).toBeVisible();
});

// Decision 330 — what is still in use moves where the owner picks; the past stays.
test('closing a Branch with a weekly slot moves the slot to the chosen Branch and keeps the Branch for good', async ({ page }) => {
  const branch = await mkBranch('Hillside');
  const target = await mkBranch('Lakeside');
  const slot = await db.timetableSlot.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      branchId: branch.id,
      weekday: 'MONDAY',
      startTime: new Date(Date.UTC(1970, 0, 1, 18, 0)),
      endTime: new Date(Date.UTC(1970, 0, 1, 19, 0)),
      title: 'Hillside Monday',
      activities: ['BJJ'],
    },
  });
  slotIds.push(slot.id);
  const past = new Date(Date.now() - 7 * 86_400_000);
  const pastClass = await db.class.create({
    data: { id: randomUUID(), schoolId: s.schoolId, branchId: branch.id, title: 'Last week at Hillside', startDate: past, endDate: new Date(past.getTime() + 3_600_000) },
  });
  classIds.push(pastClass.id);

  await signIn(page, s.ownerToken);
  await page.goto('/branches');
  await page.getByRole('button', { name: 'Actions for Hillside' }).click();
  await page.getByRole('menu', { name: 'Actions for Hillside' }).getByRole('menuitem', { name: 'Close branch' }).click();
  const dialog = page.getByRole('dialog', { name: 'Close Hillside?' });

  const where = dialog.getByLabel('Upcoming classes: 0 · Weekly timetable slots: 1');
  await expect(where).toBeVisible();
  await expect(where.locator('option', { hasText: 'Hillside' })).toHaveCount(0);
  await expect(dialog.getByText(/has history, so it will be kept for good/)).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Close branch' });
  await expect(confirm).toBeDisabled();

  await where.selectOption({ label: 'Lakeside' });
  await confirm.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Hillside', exact: true })).toHaveCount(0);

  expect((await db.timetableSlot.findUnique({ where: { id: slot.id } }))?.branchId).toBe(target.id);
  expect((await db.class.findUnique({ where: { id: pastClass.id } }))?.branchId).toBe(branch.id);
  const closed = await db.branch.findUnique({ where: { id: branch.id } });
  expect(closed?.archivedAt).not.toBeNull();
  expect(closed?.purgeAt).toBeNull();
});

test('staff roles with no other open Branch to go to: the window says so and cannot close', async ({ page }) => {
  const branch = await mkBranch('Solo');
  await db.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: s.ownerId, schoolId: s.schoolId, branchId: branch.id } });

  await signIn(page, s.ownerToken);
  await page.goto('/branches');
  await page.getByRole('button', { name: 'Actions for Solo' }).click();
  await page.getByRole('menu', { name: 'Actions for Solo' }).getByRole('menuitem', { name: 'Close branch' }).click();
  const dialog = page.getByRole('dialog', { name: 'Close Solo?' });
  await expect(dialog.getByTestId('close-branch-staff-stuck')).toContainText('Remove their access on the Staff page first');
  await expect(dialog.getByRole('button', { name: 'Close branch' })).toBeDisabled();
});

test('Branch pickers leave out closed Branches, except the one a class already uses', async ({ page }) => {
  await mkBranch('Open Branch');
  const closed = await mkBranch('Old Branch', true);
  const start = new Date(Date.now() + 7 * 86_400_000);
  const cls = await db.class.create({
    data: { id: randomUUID(), schoolId: s.schoolId, branchId: closed.id, title: 'Class at Old Branch', startDate: start, endDate: new Date(start.getTime() + 3_600_000) },
  });
  classIds.push(cls.id);

  await signIn(page, s.ownerToken);
  await page.goto('/classes');

  await page.getByRole('button', { name: 'Add class' }).click();
  const addOptions = page.getByRole('dialog').getByLabel('Branch').locator('option');
  await expect(addOptions).toContainText(['Whole School', 'Open Branch']);
  await expect(addOptions.filter({ hasText: 'Old Branch' })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Actions for Class at Old Branch' }).click();
  await page.getByRole('menu', { name: 'Actions for Class at Old Branch' }).getByRole('menuitem', { name: 'Edit' }).click();
  const editBranch = page.getByRole('dialog', { name: 'Edit class' }).getByLabel('Branch');
  await expect(editBranch).toHaveValue(closed.id);
  await expect(editBranch.locator('option', { hasText: 'Old Branch (Closed)' })).toHaveCount(1);
});
