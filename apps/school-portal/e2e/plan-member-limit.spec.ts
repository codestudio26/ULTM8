import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';
import { pickOption } from './team-helpers';

/**
 * Decision 316 item 5 / Decision 435 items 10-15: the owner sets a member
 * limit on the plan form (blank = none), and the plan's Members page shows
 * the places taken and the waiting list, first in line first.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await db.school.update({ where: { id: s.schoolId }, data: { defaultCurrency: 'GBP' } });
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.planWaitlistEntry.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

test('the owner sets a member limit on a plan, and clears it', async ({ page }) => {
  await page.goto('/membership-plans');
  await page.getByRole('button', { name: 'Add plan' }).click();
  await page.getByLabel('Title').fill('Competition team');
  await pickOption(page, 'Type', 'Weekly Pass');
  await page.getByRole('button', { name: '2. Pricing & Access' }).click();
  await page.getByLabel('Price').fill('40');
  await page.getByLabel('Expiry duration (days)').fill('30');
  await page.getByLabel('Member limit').fill('12');
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'Competition team', exact: true })).toBeVisible();
  const plan = await db.membershipPlan.findFirstOrThrow({ where: { schoolId: s.schoolId, title: 'Competition team' } });
  expect(plan.memberLimit).toBe(12);

  await page.goto(`/membership-plans/${plan.id}/edit`);
  await page.getByRole('button', { name: '2. Pricing & Access' }).click();
  await page.getByLabel('Member limit').fill('');
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'Competition team', exact: true })).toBeVisible();
  expect((await db.membershipPlan.findUniqueOrThrow({ where: { id: plan.id } })).memberLimit).toBeNull();
});

test("the plan's Members page shows the places taken and the waiting list", async ({ page }) => {
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, type: 'WEEKLY_PASS', title: 'Small group', price: 2000, currency: 'GBP', expiryDurationDays: 30, memberLimit: 1 },
  });
  await db.membership.create({
    data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: plan.id, schoolId: s.schoolId, frequency: 'ONE_TIME', expiryDate: new Date(Date.now() + 10 * 86_400_000) },
  });
  await db.planWaitlistEntry.create({
    data: { id: randomUUID(), schoolId: s.schoolId, membershipPlanId: plan.id, studentId: s.student.id, joinedById: s.student.id },
  });
  await page.goto(`/membership-plans/${plan.id}/members`);
  await expect(page.getByTestId('plan-places')).toHaveText('1 of 1 places taken');
  await expect(page.getByTestId('plan-waitlist').getByRole('listitem')).toHaveCount(1);
  await expect(page.getByTestId('plan-waitlist')).toContainText('Waiting since');
});
