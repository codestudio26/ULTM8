import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The Staff page (Decisions 296, 361): "Give role" finds someone (ignoring
 * capitals, Decision 295) and gives them a role at once; the staff list shows
 * them straight away, with their branch's name; removing one role or the whole
 * person asks first; removed staff are hidden until the "Removed" status is
 * picked; and anyone but the owner is sent to their own home screen.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterAll(async () => {
  await cleanup();
});

type Page = import('@playwright/test').Page;
const giveCard = (page: Page) => page.locator('.ultm8-card').filter({ hasText: 'Give a role' });
const listCard = (page: Page) => page.locator('.ultm8-card').filter({ hasText: 'Your staff' });
const permissionsCard = (page: Page) => page.locator('.ultm8-card').filter({ hasText: 'What Branch Staff can do' });
const listRow = (page: Page, name: string) => listCard(page).getByRole('row').filter({ hasText: name });

test('the owner gives someone Branch Staff, sees them in the list, and removes the role after confirming', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const tara = await addPerson('Tara', 'Target');
  await signIn(page, s.ownerToken);
  await page.goto('/staff');

  // Find ignores capitals (Decision 295).
  await giveCard(page).getByLabel('Email').fill(tara.email.toUpperCase());
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.getByText('Found Tara Target.')).toBeVisible();
  await giveCard(page).getByLabel('Role').selectOption('BRANCH_STAFF');
  await giveCard(page).getByLabel('Branch').selectOption({ label: 'North' });
  await giveCard(page).getByRole('button', { name: 'Give role' }).click();
  await expect(page.getByText(/^Tara Target is now Branch Staff/)).toBeVisible();

  // The list and "What Branch Staff can do" show them at once, no reload, with
  // the branch's name rather than its id.
  const row = listRow(page, 'Tara Target');
  await expect(row.getByText('Branch Staff · North')).toBeVisible();
  await expect(listCard(page).getByText(north.id)).toHaveCount(0);
  await expect(permissionsCard(page).getByRole('cell', { name: 'Tara Target', exact: true })).toBeVisible();

  // Removing the role asks first; Cancel changes nothing.
  await row.getByRole('button', { name: 'Actions for Tara Target' }).click();
  await page.getByRole('menuitem', { name: 'Remove Branch Staff · North' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove the Branch Staff role from Tara Target?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await db.roleGrant.findFirstOrThrow({ where: { userId: tara.id, role: 'BRANCH_STAFF' } })).revokedAt).toBeNull();

  await row.getByRole('button', { name: 'Actions for Tara Target' }).click();
  await page.getByRole('menuitem', { name: 'Remove Branch Staff · North' }).click();
  await dialog.getByRole('button', { name: 'Revoke' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await db.roleGrant.findFirstOrThrow({ where: { userId: tara.id, role: 'BRANCH_STAFF' } })).revokedAt).not.toBeNull();

  // ...they leave the active list and "What Branch Staff can do" at once.
  await expect(listRow(page, 'Tara Target')).toHaveCount(0);
  await expect(permissionsCard(page).getByRole('cell', { name: 'Tara Target', exact: true })).toHaveCount(0);
});

test('the list filters by role, branch and name, and "Remove from School" ends every coach and staff role', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const south = await addBranch(s, 'South');
  const cal = await addPerson('Cal', 'Coach', [
    { role: 'INSTRUCTOR', schoolId: s.schoolId, branchId: north.id },
    { role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: south.id },
    { role: 'STUDENT', schoolId: s.schoolId, branchId: north.id },
  ]);
  await db.staffPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: cal.id, canInviteCoaches: true } });
  await addPerson('Dee', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  await signIn(page, s.ownerToken);
  await page.goto('/staff');

  await expect(listRow(page, 'Cal Coach').getByText('Instructor · North')).toBeVisible();
  await expect(listRow(page, 'Cal Coach').getByText('Can invite coaches')).toBeVisible();
  await expect(listRow(page, 'Dee Desk')).toBeVisible();

  await listCard(page).getByLabel('Branch').selectOption({ label: 'South' });
  await expect(listRow(page, 'Dee Desk')).toHaveCount(0);
  await expect(listRow(page, 'Cal Coach')).toBeVisible();
  await listCard(page).getByLabel('Branch').selectOption({ label: 'Any' });
  await listCard(page).getByLabel('Search').fill('DEE');
  await expect(listRow(page, 'Cal Coach')).toHaveCount(0);
  await expect(listRow(page, 'Dee Desk')).toBeVisible();
  await listCard(page).getByLabel('Search').fill('');
  await listCard(page).getByLabel('Role').selectOption('INSTRUCTOR');
  await expect(listRow(page, 'Dee Desk')).toHaveCount(0);
  await listCard(page).getByLabel('Role').selectOption('');

  // Remove from School asks first, then ends both roles but keeps the student one.
  await listRow(page, 'Cal Coach').getByRole('button', { name: 'Actions for Cal Coach' }).click();
  await page.getByRole('menuitem', { name: 'Remove from School' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove Cal Coach from your School?' });
  await expect(dialog).toContainText('Instructor · North');
  await expect(dialog).toContainText('Branch Staff · South');
  await dialog.getByRole('button', { name: 'Remove from School' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(listRow(page, 'Cal Coach')).toHaveCount(0);
  const grants = await db.roleGrant.findMany({ where: { userId: cal.id } });
  expect(grants.filter((g) => g.revokedAt === null).map((g) => g.role)).toEqual(['STUDENT']);
  expect((await db.staffPermission.findFirstOrThrow({ where: { userId: cal.id } })).canInviteCoaches).toBe(false);

  // Removed staff stay findable under "Removed".
  await listCard(page).getByLabel('Status').selectOption('removed');
  await expect(listRow(page, 'Cal Coach').getByText(/^Removed /)).toBeVisible();
  await expect(listRow(page, 'Dee Desk')).toHaveCount(0);
  await expect(listRow(page, 'Cal Coach').getByRole('button', { name: 'Actions for Cal Coach' })).toHaveCount(0);
});

test('Branch Staff who open the Staff page go to their own dashboard', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const bea = await addPerson('Bea', 'Staff', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  await signIn(page, bea.token);
  await page.goto('/staff');
  await expect(page).toHaveURL(/\/coach$/);
});
