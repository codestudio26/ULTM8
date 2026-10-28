import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 387: the owner's Access window for a Branch Staff member (six
 * switches and the "Front desk" and "Branch manager" presets), and what the
 * Branch Staff member then sees: the Staff list read only, and Students.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterAll(async () => {
  await cleanup();
});

type Page = import('@playwright/test').Page;
const listRow = (page: Page, name: string) => page.locator('.ultm8-card').filter({ hasText: 'Your staff' }).getByRole('row').filter({ hasText: name });

test('the owner picks a preset, changes one switch, and saves', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const bea = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  await addPerson('Cal', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId, branchId: north.id }]);
  await signIn(page, s.ownerToken);
  await page.goto('/staff');

  await expect(listRow(page, 'Bea Desk').getByText('Custom access')).toBeVisible();
  // Coaches have the rights of their role: no Access for them.
  await listRow(page, 'Cal Coach').getByRole('button', { name: 'Actions for Cal Coach' }).click();
  await expect(page.getByRole('menuitem', { name: 'Access' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await listRow(page, 'Bea Desk').getByRole('button', { name: 'Actions for Bea Desk' }).click();
  await page.getByRole('menuitem', { name: 'Access' }).click();
  const dialog = page.getByRole('dialog', { name: 'Access for Bea Desk' });
  await expect(dialog.getByText('Custom access')).toBeVisible();

  await dialog.getByRole('button', { name: 'Front desk' }).click();
  await expect(dialog.getByRole('button', { name: 'Front desk' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByText('Matches Front desk')).toBeVisible();
  await expect(dialog.getByLabel('Manage bookings and check-in')).toBeChecked();
  await expect(dialog.getByLabel('Cancel classes and give credit back')).not.toBeChecked();

  await dialog.getByRole('button', { name: 'Branch manager' }).click();
  await expect(dialog.getByLabel('Manage classes and the timetable')).toBeChecked();
  // Disciplines change the whole School, so no preset ticks them.
  await expect(dialog.getByLabel('Manage disciplines')).not.toBeChecked();
  await dialog.getByLabel('See the staff list').uncheck();
  await expect(dialog.getByText('Custom access')).toBeVisible();
  await dialog.getByLabel('See the staff list').check();
  await expect(dialog.getByText('Matches Branch manager')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Access saved for Bea Desk.')).toBeVisible();
  await expect(listRow(page, 'Bea Desk').getByText('Branch manager')).toBeVisible();
  const row = await db.staffPermission.findFirstOrThrow({ where: { userId: bea.id } });
  expect(row).toMatchObject({
    canManageClasses: true,
    canManageBookings: true,
    canManageStudents: true,
    canCancelClasses: true,
    canSeeStaffList: true,
    canInviteCoaches: true,
    canManageDisciplines: false,
  });
});

test('Branch Staff see the staff list read only, and Students, only when switched on', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const bea = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  await addPerson('Cal', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId, branchId: north.id }]);

  // Defaults: no staff list, and Students is off the menu until switched on.
  await signIn(page, bea.token);
  await page.goto('/staff');
  await expect(page).not.toHaveURL(/\/staff$/);
  await expect(page.getByRole('link', { name: 'Staff', exact: true })).toHaveCount(0);

  await db.staffPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: bea.id, canSeeStaffList: true, canManageStudents: true } });
  await page.goto('/staff');
  await expect(page.getByText("The staff at your branches. Only the School's owners can change roles or access.")).toBeVisible();
  await expect(listRow(page, 'Cal Coach')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Actions for / })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Staff', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Students', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Students' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite a Student' })).toHaveCount(0);
});
