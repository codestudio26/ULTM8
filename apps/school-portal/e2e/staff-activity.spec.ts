import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 408: the Staff page's Activity section lists who changed what,
 * newest first, with a filter by person. Owners and co-owners only.
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
const activity = (page: Page) => page.getByRole('list', { name: 'Activity' });

test('a change on the Staff page shows in Activity, and the filter picks one person', async ({ page }) => {
  const north = await addBranch(s, 'North');
  await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  const cal = await addPerson('Cal', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId, branchId: north.id }]);
  // An older line about Cal, written before this test's change.
  await db.staffActivity.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      actorId: s.ownerId,
      targetUserId: cal.id,
      action: 'ROLE_GIVEN',
      details: { role: 'INSTRUCTOR', branchName: 'North' },
      createdAt: new Date(Date.now() - 60_000),
    },
  });
  await signIn(page, s.ownerToken);
  await page.goto('/staff');
  await expect(activity(page).getByText('Olive Owner gave Cal Coach the Instructor role at North.')).toBeVisible();

  await listRow(page, 'Bea Desk').getByRole('button', { name: 'Actions for Bea Desk' }).click();
  await page.getByRole('menuitem', { name: 'Pause', exact: true }).click();
  await page.getByRole('dialog', { name: 'Pause Bea Desk?' }).getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Bea Desk is paused.')).toBeVisible();

  // Newest first: the pause sits above the older line.
  const items = activity(page).getByRole('listitem');
  await expect(items.first()).toContainText('Olive Owner paused Bea Desk.');
  await expect(items).toHaveCount(2);

  await page.getByLabel('Person').selectOption({ label: 'Cal Coach' });
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('Olive Owner gave Cal Coach the Instructor role at North.');
});

test('Branch Staff who can see the staff list do not see Activity', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const bea = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  await db.staffPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: bea.id, canSeeStaffList: true } });
  await signIn(page, bea.token);
  await page.goto('/staff');
  await expect(page.getByText("The staff at your branches. Only the School's owners can change roles or access.")).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Activity' })).toHaveCount(0);
});
