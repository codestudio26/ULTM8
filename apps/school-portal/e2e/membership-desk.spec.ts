import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 348 — the owner's Memberships card on a Student's page (sell a
 * plan at the desk, give a Friend Pass, cancel a Subscription) and the
 * per-plan member list. Cancelling calls Stripe, so the browser test covers
 * the button and the cancelled state; the API test stubs Stripe and covers
 * the call itself.
 */
let s: GradingSchool;

async function mkPlan(data: Record<string, unknown>) {
  return db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, currency: 'GBP', ...data } as never });
}

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await db.paymentAccount.create({
    data: { id: randomUUID(), schoolId: s.schoolId, provider: 'BANK_TRANSFER', accountTitle: 'Desk', country: 'GB' },
  });
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.transaction.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
  await db.paymentAccount.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

test('the owner sells a Class Pack at the desk, paid by bank transfer, and it shows straight away', async ({ page }) => {
  await mkPlan({ title: 'Ten classes', type: 'CLASS_PACK', price: 6000, classesIncluded: 10, expiryDurationDays: 90 });
  await mkPlan({ title: 'Monthly', type: 'SUBSCRIPTION', price: 5000 });

  await page.goto(`/students/${s.student.id}`);
  await expect(page.getByRole('heading', { name: 'Memberships' })).toBeVisible();
  await expect(page.getByText('No memberships yet')).toBeVisible();

  await page.getByRole('button', { name: 'Sell a plan' }).click();
  // A Subscription is card only, so it isn't offered.
  await expect(page.locator('#desk-plan option')).toHaveText(['Ten classes (60.00 GBP)']);
  await page.getByLabel('Paid by').selectOption('BANK_TRANSFER');
  await page.getByRole('button', { name: 'Record sale' }).click();

  const row = page.getByRole('row', { name: /Ten classes/ });
  await expect(row).toContainText('Active');
  await expect(row).toContainText('10 classes left');

  const tx = await db.transaction.findFirstOrThrow({ where: { schoolId: s.schoolId, studentId: s.student.id } });
  expect(tx).toMatchObject({ status: 'SUCCESSFUL', paymentMethod: 'BANK_TRANSFER', amount: 6000 });
});

test('the owner gives a Friend Pass', async ({ page }) => {
  await mkPlan({ title: 'Bring a friend', type: 'FRIEND_PASS', price: 0, classesIncluded: 1 });
  await page.goto(`/students/${s.student.id}`);
  await page.getByRole('button', { name: 'Give a Friend Pass' }).click();
  await page.getByRole('button', { name: 'Give pass' }).click();

  const row = page.getByRole('row', { name: /Bring a friend/ });
  await expect(row).toContainText('Given by the School');
  const pass = await db.membership.findFirstOrThrow({ where: { schoolId: s.schoolId, studentId: s.student.id } });
  expect(pass.giftedById).toBe(s.ownerId);
});

test('a live Subscription has a Cancel button; a cancelled one shows when it ends', async ({ page }) => {
  const plan = await mkPlan({ title: 'Monthly', type: 'SUBSCRIPTION', price: 5000 });
  await db.membership.create({
    data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: plan.id, schoolId: s.schoolId, frequency: 'RECURRING', stripeSubscriptionId: `sub_${randomUUID()}` },
  });
  await db.membership.create({
    data: {
      id: randomUUID(), studentId: s.newStudent.id, membershipPlanId: plan.id, schoolId: s.schoolId, frequency: 'RECURRING',
      stripeSubscriptionId: `sub_${randomUUID()}`, cancelAt: new Date('2030-03-15T12:00:00Z'),
    },
  });

  await page.goto(`/students/${s.student.id}`);
  await page.getByRole('row', { name: /Monthly/ }).getByRole('button', { name: 'Cancel subscription' }).click();
  await expect(page.getByRole('heading', { name: 'Cancel Monthly?' })).toBeVisible();
  await expect(page.getByText(/keeps the subscription until the end of the month they have paid for/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.goto(`/students/${s.newStudent.id}`);
  const row = page.getByRole('row', { name: /Monthly/ });
  await expect(row).toContainText(/Cancelled, ends .*2030/);
  await expect(row.getByRole('button', { name: 'Cancel subscription' })).toHaveCount(0);
});

test('the plan member list shows who is on a plan, from the plan row\'s menu', async ({ page }) => {
  const plan = await mkPlan({ title: 'Ten classes', type: 'CLASS_PACK', price: 6000, classesIncluded: 10, expiryDurationDays: 90 });
  await db.membership.create({
    data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: plan.id, schoolId: s.schoolId, frequency: 'ONE_TIME', classesRemaining: 7, expiryDate: new Date('2030-01-10T12:00:00Z') },
  });
  // Used up: not a member any more.
  await db.membership.create({
    data: { id: randomUUID(), studentId: s.newStudent.id, membershipPlanId: plan.id, schoolId: s.schoolId, frequency: 'ONE_TIME', classesRemaining: 0 },
  });

  await page.goto('/membership-plans');
  await page.getByRole('button', { name: 'Actions for Ten classes' }).click();
  await page.getByRole('menuitem', { name: 'Members' }).click();

  await expect(page.getByRole('heading', { name: 'Members of Ten classes' })).toBeVisible();
  await expect(page.getByText('1 current member')).toBeVisible();
  const row = page.getByRole('row', { name: /Sam Lee/ });
  await expect(row).toContainText('7');
  await expect(row).toContainText('2030');
  await expect(page.getByRole('row', { name: /Nia Park/ })).toHaveCount(0);

  await row.getByRole('link', { name: 'Sam Lee' }).click();
  await expect(page).toHaveURL(new RegExp(`/students/${s.student.id}$`));
});
