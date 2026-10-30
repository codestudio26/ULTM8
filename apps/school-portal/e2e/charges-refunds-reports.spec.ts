import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Charges, step 4 of 6 (v1.3 backlog §3.6; Decision 338 items 3 and 11), the
 * owner's side: a cash payment partly given back with a note, which leaves
 * the charge paid and marked Part refunded, and the Billing reports page
 * (Overview and Member balances). The rules behind each step are covered by
 * apps/api/test/charges-refunds-reports.e2e-spec.ts.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await db.school.update({ where: { id: s.schoolId }, data: { defaultCurrency: 'GBP', taxRateBasisPoints: 0, taxInclusive: true } });
  await db.paymentAccount.create({ data: { id: randomUUID(), schoolId: s.schoolId, provider: 'CASH', accountTitle: 'Desk', country: 'GB' } });
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.chargeAllocation.deleteMany({ where });
  await db.balanceEntry.deleteMany({ where });
  await db.chargeRefund.deleteMany({ where });
  await db.transaction.deleteMany({ where });
  await db.charge.deleteMany({ where });
  await db.paymentAccount.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

test('the owner gives back part of a cash payment, then sees it in the billing reports', async ({ page }) => {
  await page.goto(`/students/${s.student.id}`);
  const card = page.getByTestId('student-charges');
  await card.getByRole('button', { name: '+ Create charge' }).click();
  const create = page.getByTestId('create-charge-form');
  await create.getByLabel('Description').fill('Rash guard');
  await create.getByLabel('Price').fill('60');
  await create.getByRole('button', { name: 'Create charge' }).click();

  await card.getByRole('button', { name: 'Record payment' }).click();
  const pay = page.getByTestId('record-charge-payment-form');
  await pay.getByLabel('Amount received').fill('60');
  await pay.getByRole('button', { name: 'Record payment' }).click();
  await expect(card.getByText('Nothing owed')).toBeVisible();

  await card.getByRole('button', { name: 'Refund' }).click();
  const refund = page.getByTestId('refund-charge-payment-form');
  await expect(refund.getByLabel('Where the money goes')).toHaveValue('MONEY_BACK');
  await refund.getByLabel('Amount to refund').fill('20');
  // Notes are required by default.
  await expect(refund.getByRole('button', { name: 'Refund' })).toBeDisabled();
  await refund.getByLabel('Notes (staff only)').fill('Wrong size');
  await refund.getByRole('button', { name: 'Refund' }).click();
  await expect(card.getByTestId('charge-refund-line')).toContainText('given back');
  await expect(card.getByText('Part refunded').first()).toBeVisible();
  await expect(card.getByText('Nothing owed')).toBeVisible();

  await page.goto('/billing-reports');
  await expect(page.getByRole('heading', { name: 'Billing reports' })).toBeVisible();
  await expect(page.getByTestId('charge-overview')).toContainText('£40.00');
  await page.getByRole('tab', { name: 'Member balances' }).click();
  await expect(page.getByText('Every balance is zero')).toBeVisible();
});
