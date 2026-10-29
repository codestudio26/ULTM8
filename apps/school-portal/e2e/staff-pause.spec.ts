import { expect, test } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 390: the owner pauses a Branch Staff member from the Staff list
 * (their roles stop at once, everything set for them is kept) and unpauses
 * them again.
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

test('the owner pauses a Branch Staff member and unpauses them again', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const bea = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  await signIn(page, s.ownerToken);
  await page.goto('/staff');

  await listRow(page, 'Bea Desk').getByRole('button', { name: 'Actions for Bea Desk' }).click();
  await page.getByRole('menuitem', { name: 'Pause', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Pause Bea Desk?' });
  await expect(dialog.getByText('Branch Staff · North')).toBeVisible();
  await dialog.getByRole('button', { name: 'Pause' }).click();

  await expect(page.getByText('Bea Desk is paused.')).toBeVisible();
  await expect(listRow(page, 'Bea Desk').getByText(/^Paused /)).toBeVisible();
  const paused = await db.roleGrant.findFirstOrThrow({ where: { userId: bea.id, schoolId: s.schoolId } });
  expect(paused.revokedAt).not.toBeNull();
  expect(paused.pausedAt).not.toBeNull();

  // Paused people have their own status filter, and are not under Removed.
  await page.getByLabel('Status').selectOption('removed');
  await expect(listRow(page, 'Bea Desk')).toHaveCount(0);
  await page.getByLabel('Status').selectOption('paused');
  await expect(listRow(page, 'Bea Desk')).toBeVisible();

  await listRow(page, 'Bea Desk').getByRole('button', { name: 'Actions for Bea Desk' }).click();
  await expect(page.getByRole('menuitem', { name: 'Pause', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Unpause' }).click();
  await expect(page.getByText('Bea Desk is unpaused. Their roles are back.')).toBeVisible();
  await page.getByLabel('Status').selectOption('active');
  await expect(listRow(page, 'Bea Desk').getByText('Active')).toBeVisible();
  const back = await db.roleGrant.findUniqueOrThrow({ where: { id: paused.id } });
  expect(back).toMatchObject({ revokedAt: null, pausedAt: null });
});
