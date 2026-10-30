import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Staff-created charges and the member balance, step 1 of 6 (v1.3 backlog
 * §3.6; Decisions 303, 338, 411), the owner's side: the School's tax settings,
 * a discounted charge with its tax worked out, a part cash payment at the
 * desk, and cancelling with a reason, which turns what was paid into credit.
 * The rules behind each step are covered by the API test
 * (apps/api/test/charges.e2e-spec.ts).
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await db.school.update({ where: { id: s.schoolId }, data: { defaultCurrency: 'GBP' } });
  await db.paymentAccount.create({ data: { id: randomUUID(), schoolId: s.schoolId, provider: 'CASH', accountTitle: 'Desk', country: 'GB' } });
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.chargeAllocation.deleteMany({ where });
  await db.balanceEntry.deleteMany({ where });
  await db.transaction.deleteMany({ where });
  await db.charge.deleteMany({ where });
  await db.paymentAccount.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

test('the owner sets the School\'s tax: picking the country fills in its rate', async ({ page }) => {
  await page.goto('/school');
  const card = page.getByTestId('charge-settings');
  await expect(page.getByRole('heading', { name: 'Charges and tax' })).toBeVisible();
  await card.getByLabel('Country your School is in').selectOption('GB');
  await expect(card.getByLabel('Tax rate (%)')).toHaveValue('20');
  // Classes can be taxed at a lower rate: the School can change it.
  await card.getByLabel('Tax rate (%)').fill('12.5');
  await card.getByLabel('Your prices').selectOption({ label: 'Have tax added on top' });
  await card.getByLabel('Tax ID').fill('GB123456789');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByText('Saved')).toBeVisible();
  const school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(school).toMatchObject({ taxCountry: 'GB', taxRateBasisPoints: 1250, taxInclusive: false, taxId: 'GB123456789', chargeCancelReasonRequired: true });
});

test('a discounted charge, a part cash payment, and cancelling with a reason', async ({ page }) => {
  await db.school.update({ where: { id: s.schoolId }, data: { taxCountry: 'GB', taxRateBasisPoints: 2000, taxInclusive: false } });
  await page.goto(`/students/${s.student.id}`);
  const card = page.getByTestId('student-charges');
  await expect(card.getByRole('heading', { name: 'Payments' })).toBeVisible();
  await expect(card.getByText('Nothing owed')).toBeVisible();

  // 100.00 less 10% = 90.00, plus 20% tax = 108.00.
  await card.getByRole('button', { name: '+ Create charge' }).click();
  const create = page.getByTestId('create-charge-form');
  await create.getByLabel('Description').fill('Rash guard');
  await create.getByLabel('Price').fill('100');
  await create.getByLabel('Discount', { exact: true }).selectOption('PERCENT');
  await create.getByLabel('Discount amount').fill('10');
  const preview = page.getByTestId('charge-preview');
  await expect(preview).toContainText('90.00 GBP');
  await expect(preview).toContainText('18.00 GBP');
  await expect(preview).toContainText('108.00 GBP');
  await create.getByRole('button', { name: 'Create charge' }).click();
  await expect(create).toHaveCount(0);

  const row = page.getByRole('row', { name: /Rash guard/ });
  await expect(row).toContainText('#0000001');
  await expect(row).toContainText('Open');
  await expect(card.getByText('Owes 108.00 GBP')).toBeVisible();
  const charge = await db.charge.findFirstOrThrow({ where: { schoolId: s.schoolId, studentId: s.student.id } });
  expect(charge).toMatchObject({ unitAmount: 10000, discountAmount: 1000, netAmount: 9000, taxAmount: 1800, grossAmount: 10800, taxRateBasisPoints: 2000 });

  // A part payment in cash leaves the rest owed.
  await row.getByRole('button', { name: 'Pay' }).click();
  const pay = page.getByTestId('record-charge-payment-form');
  await expect(pay.getByLabel('Amount received')).toHaveValue('108');
  await pay.getByLabel('Amount received').fill('50');
  await expect(pay.getByLabel('Paid by')).toHaveValue('CASH');
  await expect(pay.getByLabel('Send receipt')).toBeChecked();
  await pay.getByRole('button', { name: 'Record payment' }).click();
  await expect(pay).toHaveCount(0);
  await expect(row).toContainText('Part paid');
  await expect(card.getByText('Owes 58.00 GBP')).toBeVisible();
  await expect(page.getByRole('row', { name: /50\.00 GBP/ })).toContainText('#0000001');

  // Cancelling asks for a reason; what was paid becomes credit.
  await row.getByRole('button', { name: 'Cancel' }).click();
  const cancel = page.getByTestId('cancel-charge-form');
  await expect(cancel).toContainText('The 50.00 GBP already paid goes onto the balance as credit.');
  await cancel.getByRole('button', { name: 'Cancel charge' }).click();
  await expect(cancel.getByText('Give a reason for cancelling this charge.')).toBeVisible();
  await cancel.getByLabel('Reason (staff only)').fill('Out of stock');
  await cancel.getByRole('button', { name: 'Cancel charge' }).click();
  await expect(cancel).toHaveCount(0);
  await expect(row).toContainText('Cancelled');
  await expect(row).toContainText('Out of stock');
  await expect(card.getByText('50.00 GBP in credit')).toBeVisible();
  const cancelled = await db.charge.findUniqueOrThrow({ where: { id: charge.id } });
  expect(cancelled).toMatchObject({ cancelReason: 'Out of stock' });
  expect(cancelled.cancelledAt).not.toBeNull();
});
