import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 368 — the School Settings review, against the real API and
 * Postgres: each card starts afresh when the Owner switches School (S1),
 * saving one card keeps what's typed in another (S2), the no-show fee in
 * normal units (S3), a closed School is read-only (S4), footer links get
 * https:// (S5), non-owners get a message (S7), the join code card (Q1), the
 * School colour (Q2), the currency prompt (Q3) and the Franchise name check (Q4).
 */
let s: GradingSchool;
const planIds: string[] = [];
const franchiseIds: string[] = [];

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterAll(async () => {
  await db.franchiseJoinRequest.deleteMany({ where: { franchiseId: { in: franchiseIds } } });
  await db.membershipPlan.deleteMany({ where: { id: { in: planIds } } });
  await cleanup();
  await db.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
});

test('S1: switching School shows that School’s cancellation and footer settings, and saves them there', async ({ page }) => {
  const s2 = await seedGradingSchool();
  const [firstId, secondId] = [s.schoolId, s2.schoolId].sort();
  await db.school.update({ where: { id: firstId }, data: { footerAboutUs: 'First about', defaultRefundCutoffHours: 4 } });
  await db.school.update({ where: { id: secondId }, data: { footerAboutUs: 'Second about', defaultRefundCutoffHours: 9 } });
  const owner = await addPerson('Olive', 'Owner', [
    { role: 'SCHOOL_OWNER_MANAGER', schoolId: s.schoolId },
    { role: 'SCHOOL_OWNER_MANAGER', schoolId: s2.schoolId },
  ]);
  await signIn(page, owner.token);
  await page.goto('/school');
  await expect(page.getByLabel('About us')).toHaveValue('First about');
  await expect(page.getByLabel('Default cutoff (hours before class)')).toHaveValue('4');

  await page.getByRole('combobox', { name: 'Switch School' }).selectOption(secondId);
  await expect(page.getByLabel('About us')).toHaveValue('Second about');
  await expect(page.getByLabel('Default cutoff (hours before class)')).toHaveValue('9');

  const footer = page.locator('form').filter({ hasText: /About us/ });
  await footer.getByRole('button', { name: 'Save changes' }).click();
  await expect(footer.getByText('Saved.')).toBeVisible();
  expect((await db.school.findUniqueOrThrow({ where: { id: firstId } })).footerAboutUs).toBe('First about');
  expect((await db.school.findUniqueOrThrow({ where: { id: secondId } })).footerAboutUs).toBe('Second about');
});

test('S2 and S5: saving the footer keeps unsaved School details, and a bare link gets https://', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/school');
  await expect(page.getByRole('heading', { name: 'Bookings and check-in' })).toBeVisible();
  await page.getByLabel('Description').fill('Typed, not saved yet');

  const footer = page.locator('form').filter({ hasText: /About us/ });
  await footer.getByLabel('Instagram URL').fill('instagram.com/myschool');
  await footer.getByRole('button', { name: 'Save changes' }).click();
  await expect(footer.getByText('Saved.')).toBeVisible();
  await expect(footer.getByLabel('Instagram URL')).toHaveValue('https://instagram.com/myschool');
  expect((await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).footerInstagramUrl).toBe('https://instagram.com/myschool');

  await expect(page.getByLabel('Description')).toHaveValue('Typed, not saved yet');
});

test('S3: the no-show fee is typed in normal units, and a wrong amount says so', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/school');
  const card = page.locator('form').filter({ hasText: 'Class cancellations' });
  await card.getByLabel('No-show fee').fill('10.5.0');
  await expect(card.getByText('Enter an amount like 10 or 10.50.')).toBeVisible();
  await card.getByLabel('No-show fee').fill('10.50');
  await card.getByRole('button', { name: 'Save changes' }).click();
  await expect(card.getByText('Saved.')).toBeVisible();
  expect((await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).noShowFee).toBe(1050);
  await page.reload();
  await expect(page.getByLabel('No-show fee')).toHaveValue('10.50');
});

test('S4: a closed School’s page is read-only', async ({ page }) => {
  await db.school.update({ where: { id: s.schoolId }, data: { archivedAt: new Date(), purgeAt: new Date(Date.now() + 90 * 86_400_000) } });
  await signIn(page, s.ownerToken);
  await page.goto('/school');
  await expect(page.getByRole('heading', { name: 'This School is closed' })).toBeVisible();
  await expect(page.getByLabel('School name')).toBeDisabled();
  await expect(page.getByLabel('About us')).toBeDisabled();
  for (const button of await page.getByTestId('school-settings').getByRole('button', { name: 'Save changes' }).all()) {
    await expect(button).toBeDisabled();
  }
  await expect(page.getByLabel('Franchise ID')).toHaveCount(0);
  await expect(page.getByTestId('school-join-code')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close School' })).toHaveCount(0);
});

test('S7: Branch Staff opening the School page are told it is for Owners', async ({ page }) => {
  const { token } = await addPerson('Bea', 'Staff', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId }]);
  await signIn(page, token);
  await page.goto('/school');
  await expect(page.getByTestId('school-owners-only')).toContainText("Only the School's Owners");
});

test('Q1: the join code shows, and "Make a new code" asks first, then replaces it', async ({ page }) => {
  const before = (await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).joinCode;
  await signIn(page, s.ownerToken);
  await page.goto('/school');
  await expect(page.getByTestId('school-join-code')).toHaveText(before);

  await page.getByRole('button', { name: 'Make a new code' }).click();
  const dialog = page.getByRole('dialog', { name: 'Make a new join code?' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect((await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).joinCode).toBe(before);

  await page.getByRole('button', { name: 'Make a new code' }).click();
  await dialog.getByRole('button', { name: 'Make a new code' }).click();
  await expect(dialog).toHaveCount(0);
  const after = (await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).joinCode;
  expect(after).not.toBe(before);
  await expect(page.getByTestId('school-join-code')).toHaveText(after);
});

test('Q2 and Q3: the School colour saves, and changing the currency asks first when plans follow it', async ({ page }) => {
  await db.school.update({ where: { id: s.schoolId }, data: { defaultCurrency: 'BRL' } });
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, title: 'Follows School', type: 'CLASS_PACK', price: 15000, classesIncluded: 10 },
  });
  planIds.push(plan.id);
  await signIn(page, s.ownerToken);
  await page.goto('/school');

  await page.getByLabel('Colour').fill('#c0ffee');
  await page.getByLabel('Default currency').click();
  await page.getByRole('option', { name: /USD/ }).first().click();
  await page.getByRole('button', { name: 'Save changes' }).first().click();

  const dialog = page.getByRole('dialog', { name: 'Change the currency?' });
  await expect(dialog.getByTestId('currency-confirm-body')).toContainText("Membership plans charged in the School's currency: 1. From now on they're charged in USD");
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect((await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).defaultCurrency).toBe('BRL');

  await page.getByRole('button', { name: 'Save changes' }).first().click();
  await dialog.getByRole('button', { name: 'Change currency' }).click();
  await expect(page.getByText('Saved.').first()).toBeVisible();
  const school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(school.defaultCurrency).toBe('USD');
  expect(school.accentColor).toBe('#c0ffee');
});

test('Q4: "Ask to join" shows the Franchise’s name before the request goes out', async ({ page }) => {
  const franchise = await db.franchise.create({ data: { id: randomUUID(), name: 'Alliance Check HQ' } });
  franchiseIds.push(franchise.id);
  await signIn(page, s.ownerToken);
  await page.goto('/school');
  await page.getByLabel('Franchise ID').fill(franchise.id);
  await page.getByRole('button', { name: 'Ask to join' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ask to join this Franchise?' });
  await expect(dialog.getByTestId('franchise-join-confirm')).toContainText("You're asking to join Alliance Check HQ.");
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await db.franchiseJoinRequest.count({ where: { schoolId: s.schoolId } })).toBe(0);

  await page.getByRole('button', { name: 'Ask to join' }).click();
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByTestId('franchise-join-pending')).toBeVisible();
  expect(await db.franchiseJoinRequest.count({ where: { schoolId: s.schoolId, status: 'PENDING' } })).toBe(1);
});
