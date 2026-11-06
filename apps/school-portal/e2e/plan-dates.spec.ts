import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 316 item 4 / Decision 435 items 7-9 on the plan form: a pass that
 * starts on the first check-in, a camp on fixed dates, and the plan one
 * switches to when it ends; the Student's page says a membership hasn't
 * started yet and what it switches to.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await db.school.update({ where: { id: s.schoolId }, data: { defaultCurrency: 'GBP' } });
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.membership.deleteMany({ where });
  await db.membershipPlan.updateMany({ where, data: { switchToPlanId: null } });
  await db.membershipPlan.deleteMany({ where });
  await db.paymentAccount.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

async function startPlan(page: import('@playwright/test').Page, title: string, type: string) {
  await page.goto('/membership-plans');
  await page.getByRole('button', { name: 'Add plan' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Type').selectOption(type);
  await page.getByRole('button', { name: '2. Pricing & Access' }).click();
}

test('a camp on fixed dates that switches to a Class Pack when it ends', async ({ page }) => {
  // The switch charges a saved card, so the School takes cards (Decision 441 item 3).
  await db.paymentAccount.create({ data: { id: randomUUID(), schoolId: s.schoolId, provider: 'STRIPE', accountTitle: 'Card', country: 'GB' } });
  const next = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: 'Ten classes', price: 6000, currency: 'GBP', classesIncluded: 10 },
  });
  await startPlan(page, 'Summer camp', 'WEEKLY_PASS');
  await page.getByLabel('Price').fill('120');
  await page.getByLabel('First day').fill('2027-07-01');
  await page.getByLabel('Last day').fill('2027-08-11');
  // Fixed dates take the place of the number of days, and of "first check-in".
  await expect(page.getByLabel("Starts on the member's first check-in")).toHaveCount(0);
  await page.getByRole('button', { name: '3. Policies' }).click();
  await page.getByLabel('When it ends, switch to').selectOption({ label: 'Ten classes' });
  // Decision 438 item 2 / Decision 436 item 8: the owner is told a full next plan ends it too.
  await expect(page.getByText('Without a saved card, or if this plan is full, theirs simply ends and nothing is charged.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'Summer camp', exact: true })).toBeVisible();
  const plan = await db.membershipPlan.findFirstOrThrow({ where: { schoolId: s.schoolId, title: 'Summer camp' } });
  expect(plan.fixedStartDate?.toISOString().slice(0, 10)).toBe('2027-07-01');
  expect(plan.fixedEndDate?.toISOString().slice(0, 10)).toBe('2027-08-11');
  expect(plan).toMatchObject({ expiryDurationDays: null, switchToPlanId: next.id, startsOnFirstCheckIn: false });
});

test('a School that takes no cards has no "switch to" on the plan form (Decision 441 item 3)', async ({ page }) => {
  await db.paymentAccount.create({ data: { id: randomUUID(), schoolId: s.schoolId, provider: 'BANK_TRANSFER', accountTitle: 'Pix', country: 'BR' } });
  const next = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: 'Ten classes', price: 6000, currency: 'GBP', classesIncluded: 10 },
  });
  // A plan given a next plan before keeps it when edited.
  const older = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, type: 'WEEKLY_PASS', title: 'Intro week', price: 2000, currency: 'GBP', expiryDurationDays: 7, switchToPlanId: next.id },
  });
  await startPlan(page, 'Summer camp', 'WEEKLY_PASS');
  await page.getByLabel('Price').fill('120');
  await page.getByLabel('Expiry duration (days)').fill('7');
  await page.getByRole('button', { name: '3. Policies' }).click();
  await expect(page.getByLabel('Requires signed waiver/terms to purchase')).toBeVisible();
  await expect(page.getByLabel('When it ends, switch to')).toHaveCount(0);

  await page.goto(`/membership-plans/${older.id}/edit`);
  await page.getByLabel('Title').fill('Intro week plus');
  await page.getByRole('button', { name: '3. Policies' }).click();
  await expect(page.getByLabel('When it ends, switch to')).toHaveCount(0);
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'Intro week plus', exact: true })).toBeVisible();
  expect(await db.membershipPlan.findUniqueOrThrow({ where: { id: older.id } })).toMatchObject({ title: 'Intro week plus', switchToPlanId: next.id });
});

test("a pass that starts on the first check-in, shown on the Student's page until then", async ({ page }) => {
  await startPlan(page, 'Intro week', 'WEEKLY_PASS');
  await page.getByLabel('Price').fill('20');
  await page.getByLabel('Expiry duration (days)').fill('7');
  await page.getByLabel("Starts on the member's first check-in").check();
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'Intro week', exact: true })).toBeVisible();
  const plan = await db.membershipPlan.findFirstOrThrow({ where: { schoolId: s.schoolId, title: 'Intro week' } });
  expect(plan).toMatchObject({ startsOnFirstCheckIn: true, expiryDurationDays: 7 });

  await db.membership.create({
    data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: plan.id, schoolId: s.schoolId, frequency: 'ONE_TIME', awaitingFirstCheckIn: true },
  });
  await page.goto(`/students/${s.student.id}`);
  await expect(page.getByRole('row', { name: /Intro week/ })).toContainText('Starts on first check-in');
});
