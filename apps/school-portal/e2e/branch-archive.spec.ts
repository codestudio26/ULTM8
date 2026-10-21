import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 280 — archiving a Branch asks first and shows what still belongs
 * to it inside the dialog; archived Branches are left out of Branch pickers,
 * except the one a record being edited already points at.
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

test('Archive asks first: Cancel leaves the Branch, confirming archives it', async ({ page }) => {
  await mkBranch('Riverside');
  await signIn(page, s.ownerToken);
  await page.goto('/branches');

  const openArchive = async () => {
    await page.getByRole('button', { name: 'Actions for Riverside' }).click();
    await page.getByRole('menu', { name: 'Actions for Riverside' }).getByRole('menuitem', { name: 'Archive' }).click();
  };

  await openArchive();
  const dialog = page.getByRole('dialog', { name: 'Archive Riverside?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Riverside', exact: true })).toBeVisible();

  await openArchive();
  await page.getByRole('dialog', { name: 'Archive Riverside?' }).getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Riverside', exact: true })).toHaveCount(0);
  await expect(page.getByText('Show archived (1)')).toBeVisible();
});

test('a Branch with a weekly timetable slot is not archived, and the dialog says why', async ({ page }) => {
  const branch = await mkBranch('Hillside');
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

  await signIn(page, s.ownerToken);
  await page.goto('/branches');
  await page.getByRole('button', { name: 'Actions for Hillside' }).click();
  await page.getByRole('menu', { name: 'Actions for Hillside' }).getByRole('menuitem', { name: 'Archive' }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive Hillside?' });
  await dialog.getByRole('button', { name: 'Archive' }).click();

  await expect(dialog.getByText(/1 weekly timetable slot/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('cell', { name: 'Hillside', exact: true })).toBeVisible();
});

test('Branch pickers leave out archived Branches, except the one a class already uses', async ({ page }) => {
  await mkBranch('Open Branch');
  const closed = await mkBranch('Closed Branch', true);
  const start = new Date(Date.now() + 7 * 86_400_000);
  const cls = await db.class.create({
    data: { id: randomUUID(), schoolId: s.schoolId, branchId: closed.id, title: 'Class at Closed Branch', startDate: start, endDate: new Date(start.getTime() + 3_600_000) },
  });
  classIds.push(cls.id);

  await signIn(page, s.ownerToken);
  await page.goto('/classes');

  await page.getByRole('button', { name: 'Add class' }).click();
  const addOptions = page.getByRole('dialog').getByLabel('Branch').locator('option');
  await expect(addOptions).toContainText(['Whole School', 'Open Branch']);
  await expect(addOptions.filter({ hasText: 'Closed Branch' })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Actions for Class at Closed Branch' }).click();
  await page.getByRole('menu', { name: 'Actions for Class at Closed Branch' }).getByRole('menuitem', { name: 'Edit' }).click();
  const editBranch = page.getByRole('dialog', { name: 'Edit class' }).getByLabel('Branch');
  await expect(editBranch).toHaveValue(closed.id);
  await expect(editBranch.locator('option', { hasText: 'Closed Branch (Archived)' })).toHaveCount(1);
});
