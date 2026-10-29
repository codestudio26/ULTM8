import { expect, test } from '@playwright/test';
import { addBranch, addCoachInvite, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 396: "New staff must accept first". With it on, "Give role" for a
 * coach or Branch Staff sends an invite link instead of giving the role, and
 * the person gets the role when they accept.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterAll(async () => {
  await cleanup();
});

test('with the setting on, "Give role" sends a Branch Staff invite instead', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const bea = await addPerson('Bea', 'Hire');
  await signIn(page, s.ownerToken);
  await page.goto('/staff');

  const setting = page.getByRole('switch', { name: 'New staff must accept first' });
  await expect(setting).toHaveAttribute('aria-checked', 'false');
  await setting.click();
  await expect(setting).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).staffMustAcceptFirst).toBe(true);

  const card = page.locator('.ultm8-card').filter({ hasText: 'Give a role' });
  await card.getByLabel('Email').fill(bea.email);
  await card.getByRole('button', { name: 'Find' }).click();
  await expect(card.getByText('Found Bea Hire.')).toBeVisible();
  await card.getByLabel('Role').selectOption('BRANCH_STAFF');
  await card.getByLabel('Branch').selectOption(north.id);
  await card.getByRole('button', { name: 'Send invite' }).click();
  // No email provider in the test environment: the invite is kept, with a warning.
  await expect(page.getByText("The invite for Bea Hire was made, but the email couldn't be sent.", { exact: false })).toBeVisible();

  const invite = await db.coachInvite.findFirstOrThrow({ where: { schoolId: s.schoolId } });
  expect(invite).toMatchObject({ role: 'BRANCH_STAFF', branchId: north.id, email: bea.email.toLowerCase() });
  expect(await db.roleGrant.count({ where: { userId: bea.id, schoolId: s.schoolId } })).toBe(0);
  const row = page.getByRole('row', { name: new RegExp(bea.email.toLowerCase().replace(/[.+]/g, '\\$&')) });
  await expect(row.getByText('Branch Staff')).toBeVisible();

  // A co-owner still gets the role at once.
  const cara = await addPerson('Cara', 'Partner');
  await card.getByLabel('Email').fill(cara.email);
  await card.getByRole('button', { name: 'Find' }).click();
  await card.getByLabel('Role').selectOption('SCHOOL_OWNER_MANAGER');
  await expect(card.getByRole('button', { name: 'Give role' })).toBeVisible();
});

test('the invited person accepts and becomes Branch Staff', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const sam = await addPerson('Sam', 'Train', [{ role: 'STUDENT', schoolId: s.schoolId }]);
  const token = await addCoachInvite(s, sam.email, { branchId: north.id, role: 'BRANCH_STAFF' });
  await signIn(page, sam.token);
  await page.goto(`/coach-invite/${token}`);
  await expect(page.getByRole('heading', { name: "You're invited to join the staff" })).toBeVisible();
  await page.getByRole('button', { name: 'Accept invite' }).click();
  await expect(page.getByText(/You're now Branch Staff at Portal E2E/)).toBeVisible();

  const roles = (await db.roleGrant.findMany({ where: { userId: sam.id, revokedAt: null } })).map((g) => g.role).sort();
  expect(roles).toEqual(['BRANCH_STAFF', 'STUDENT']);
});
