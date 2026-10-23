import { expect, test } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The Staff page's invite, look-up and revoke flow (Decision 296): the "Who
 * can invite coaches" list follows grants and revokes without a reload, the
 * look-up shows branch names, Revoke asks first, Find ignores capitals
 * (Decision 295), and anyone but the owner is sent to their own home screen.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterAll(async () => {
  await cleanup();
});

const inviteCard = (page: import('@playwright/test').Page) => page.locator('.ultm8-card').filter({ hasText: 'Invite staff' });
const permissionsCard = (page: import('@playwright/test').Page) => page.locator('.ultm8-card').filter({ hasText: 'Who can invite coaches' });

test('the owner makes someone Branch Staff, looks them up, and removes the role after confirming', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const tara = await addPerson('Tara', 'Target');
  await signIn(page, s.ownerToken);
  await page.goto('/staff');

  // Find ignores capitals (Decision 295).
  await inviteCard(page).getByLabel('Email').fill(tara.email.toUpperCase());
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.getByText('Found Tara Target.')).toBeVisible();
  await inviteCard(page).getByLabel('Role').selectOption('BRANCH_STAFF');
  await inviteCard(page).getByLabel('Branch').selectOption({ label: 'North' });
  await inviteCard(page).getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText(/^Invited/)).toBeVisible();

  // "Who can invite coaches" shows them at once, no reload.
  await expect(permissionsCard(page).getByRole('cell', { name: 'Tara Target', exact: true })).toBeVisible();

  // The look-up shows the branch's name, not its id.
  await page.getByLabel('User ID').fill(tara.id);
  await page.getByRole('button', { name: 'Look up' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Branch Staff' });
  await expect(row.getByText('North')).toBeVisible();
  await expect(page.getByText(north.id)).toHaveCount(0);

  // Revoke asks first; Cancel changes nothing.
  await row.getByRole('button', { name: 'Revoke' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove the Branch Staff role from Tara Target?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await db.roleGrant.findFirstOrThrow({ where: { userId: tara.id, role: 'BRANCH_STAFF' } })).revokedAt).toBeNull();

  await row.getByRole('button', { name: 'Revoke' }).click();
  await dialog.getByRole('button', { name: 'Revoke' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row.getByText('Revoked')).toBeVisible();
  expect((await db.roleGrant.findFirstOrThrow({ where: { userId: tara.id, role: 'BRANCH_STAFF' } })).revokedAt).not.toBeNull();

  // ...and they leave "Who can invite coaches" at once too.
  await expect(permissionsCard(page).getByRole('cell', { name: 'Tara Target', exact: true })).toHaveCount(0);
});

test('Branch Staff who open the Staff page go to their own dashboard', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const bea = await addPerson('Bea', 'Staff', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  await signIn(page, bea.token);
  await page.goto('/staff');
  await expect(page).toHaveURL(/\/coach$/);
});
