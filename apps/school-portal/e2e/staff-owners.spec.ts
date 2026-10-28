import { expect, test } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Owners on the Staff page (Decision 370): the School's first owner is its
 * main owner; the owner can make someone a co-owner from "Give role"; any
 * owner can remove a co-owner but nobody can remove the main owner here; and
 * the main owner hands the main role to a co-owner after their passcode.
 */
let s: GradingSchool;

/** bcrypt of PASSCODE, so the owner can pass the passcode check. */
const PASSCODE = '246810';
const PASSCODE_HASH = '$2a$04$QgvRMStkWKUF3MhKA6PCqOyLa9KyeaFbUN70R/Q3Hdw0o0DANsmIy';

test.beforeEach(async () => {
  s = await seedGradingSchool();
  await db.user.update({ where: { id: s.ownerId }, data: { passcodeHash: PASSCODE_HASH } });
});

test.afterAll(async () => {
  await cleanup();
});

type Page = import('@playwright/test').Page;
const giveCard = (page: Page) => page.locator('.ultm8-card').filter({ hasText: 'Give a role' });
const listCard = (page: Page) => page.locator('.ultm8-card').filter({ hasText: 'Your staff' });
const listRow = (page: Page, name: string) => listCard(page).getByRole('row').filter({ hasText: name });

test('the owner makes someone a co-owner, then hands them the main owner role after their passcode', async ({ page }) => {
  const owner = await db.user.findUniqueOrThrow({ where: { id: s.ownerId } });
  const ownerName = `${owner.firstName} ${owner.surname}`.trim();
  const cara = await addPerson('Cara', 'Partner');
  await signIn(page, s.ownerToken);
  await page.goto('/staff');

  await expect(listRow(page, ownerName).getByText('Main owner')).toBeVisible();
  // The main owner has no remove action on their own owner role.
  await expect(listRow(page, ownerName).getByRole('button', { name: `Actions for ${ownerName}` })).toHaveCount(0);

  await giveCard(page).getByLabel('Email').fill(cara.email);
  await page.getByRole('button', { name: 'Find' }).click();
  await giveCard(page).getByLabel('Role').selectOption('SCHOOL_OWNER_MANAGER');
  // A co-owner is School-wide: no branch to pick.
  await expect(giveCard(page).getByLabel('Branch')).toHaveCount(0);
  await giveCard(page).getByRole('button', { name: 'Give role' }).click();
  await expect(page.getByText(/^Cara Partner is now Co-owner/)).toBeVisible();
  await expect(listRow(page, 'Cara Partner').getByText('Co-owner')).toBeVisible();

  await listRow(page, 'Cara Partner').getByRole('button', { name: 'Actions for Cara Partner' }).click();
  await page.getByRole('menuitem', { name: 'Make main owner' }).click();
  const dialog = page.getByRole('dialog', { name: 'Make Cara Partner the main owner?' });
  await dialog.getByLabel('Your passcode').fill('111111');
  await dialog.getByRole('button', { name: 'Make main owner' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect((await db.roleGrant.findFirstOrThrow({ where: { userId: cara.id, role: 'SCHOOL_OWNER_MANAGER' } })).isMainOwner).toBe(false);

  await dialog.getByLabel('Your passcode').fill(PASSCODE);
  await dialog.getByRole('button', { name: 'Make main owner' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Cara Partner is now the main owner.')).toBeVisible();
  await expect(listRow(page, 'Cara Partner').getByText('Main owner')).toBeVisible();
  await expect(listRow(page, ownerName).getByText('Co-owner')).toBeVisible();
  expect((await db.roleGrant.findFirstOrThrow({ where: { userId: cara.id, role: 'SCHOOL_OWNER_MANAGER' } })).isMainOwner).toBe(true);
  // Now a co-owner, they can't hand over or remove the new main owner.
  await expect(listRow(page, 'Cara Partner').getByRole('button', { name: 'Actions for Cara Partner' })).toHaveCount(0);
});

test('an owner removes a co-owner after confirming', async ({ page }) => {
  const dan = await addPerson('Dan', 'Partner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: s.schoolId }]);
  await signIn(page, s.ownerToken);
  await page.goto('/staff');

  const row = listRow(page, 'Dan Partner');
  await expect(row.getByText('Co-owner')).toBeVisible();
  await row.getByRole('button', { name: 'Actions for Dan Partner' }).click();
  // No coach or staff roles, so no "Remove from School".
  await expect(page.getByRole('menuitem', { name: 'Remove from School' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Remove as co-owner' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove Dan Partner as co-owner?' });
  await dialog.getByRole('button', { name: 'Remove as co-owner' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(listRow(page, 'Dan Partner')).toHaveCount(0);
  expect((await db.roleGrant.findFirstOrThrow({ where: { userId: dan.id, role: 'SCHOOL_OWNER_MANAGER' } })).revokedAt).not.toBeNull();
});
