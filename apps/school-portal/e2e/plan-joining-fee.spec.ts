import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';
import { pickOption } from './team-helpers';

/**
 * Decision 316 item 3 / Decision 435: joining fees. The owner switches them
 * on on the School page and sets a fee (refundable or not) on a paid plan; at
 * the desk, a member's first plan shows the fee and the total to collect, and
 * the refund of a non-refundable fee leaves it out.
 */
let s: GradingSchool;

async function mkPlan(data: Record<string, unknown>) {
  return db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, currency: 'GBP', ...data } as never });
}

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await db.school.update({ where: { id: s.schoolId }, data: { defaultCurrency: 'GBP' } });
  await db.paymentAccount.create({ data: { id: randomUUID(), schoolId: s.schoolId, provider: 'CASH', accountTitle: 'Desk', country: 'GB' } });
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.deskSaleRefund.deleteMany({ where });
  await db.transaction.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
  await db.paymentAccount.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

test('the owner switches joining fees on and sets a refundable fee on a plan', async ({ page }) => {
  await page.goto('/school');
  const card = page.getByTestId('joining-fee-settings');
  await card.getByLabel('Charge joining fees').check();
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByRole('status')).toHaveText('Saved.');
  expect((await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).joiningFeesEnabled).toBe(true);

  await page.goto('/membership-plans');
  await page.getByRole('button', { name: 'Add plan' }).click();
  await page.getByLabel('Title').fill('Ten classes');
  await pickOption(page, 'Type', 'Class Pack');
  await page.getByRole('button', { name: '2. Pricing & Access' }).click();
  await page.getByLabel('Price').fill('60');
  await page.getByLabel('Classes included').fill('10');
  await page.getByRole('button', { name: '3. Policies' }).click();
  await page.getByLabel('Joining fee', { exact: true }).fill('25');
  await page.getByLabel('Refund the joining fee with the membership').check();
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'Ten classes', exact: true })).toBeVisible();
  const plan = await db.membershipPlan.findFirstOrThrow({ where: { schoolId: s.schoolId, title: 'Ten classes' } });
  expect(plan).toMatchObject({ joiningFee: 2500, joiningFeeRefundable: true });
});

test('the plan form says when joining fees are off for the School', async ({ page }) => {
  const plan = await mkPlan({ title: 'Five classes', type: 'CLASS_PACK', price: 3000, classesIncluded: 5, joiningFee: 1000 });
  await page.goto(`/membership-plans/${plan.id}/edit`);
  await page.getByRole('button', { name: '3. Policies' }).click();
  await expect(page.getByTestId('joining-fees-off')).toBeVisible();
});

test("a member's first plan at the desk shows the joining fee and the total; a non-refundable fee stays out of the refund", async ({ page }) => {
  await db.school.update({ where: { id: s.schoolId }, data: { joiningFeesEnabled: true } });
  await mkPlan({ title: 'Ten classes', type: 'CLASS_PACK', price: 6000, classesIncluded: 10, joiningFee: 2500 });

  await page.goto(`/students/${s.student.id}`);
  await page.getByRole('button', { name: 'Sell a plan' }).click();
  await expect(page.getByTestId('joining-fee-notice')).toHaveText(
    'This is their first plan here, so it includes the joining fee of 25.00 GBP. Total to collect: 85.00 GBP.',
  );
  await page.getByRole('button', { name: 'Record sale' }).click();
  await expect(page.getByRole('row', { name: /Ten classes/ })).toContainText('Active');
  const tx = await db.transaction.findFirstOrThrow({ where: { schoolId: s.schoolId, studentId: s.student.id } });
  expect(tx).toMatchObject({ amount: 8500, joiningFeeAmount: 2500, joiningFeeRefundable: false });

  // The next plan is no longer their first.
  await page.getByRole('button', { name: 'Sell a plan' }).click();
  await expect(page.getByTestId('joining-fee-notice')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.goto('/transactions');
  await page.getByRole('row', { name: /Ten classes/ }).getByRole('button', { name: 'Refund' }).click();
  await expect(page.getByTestId('refund-joining-fee-kept')).toHaveText("The joining fee of 25.00 GBP isn't refundable, so it stays out of this refund.");
  await expect(page.getByLabel('Amount given back')).toHaveValue('60');
});
