import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Recurring charges, step 3 of 6 of staff-created charges (v1.3 backlog §3.6;
 * Decision 412), the owner's side: setting up a monthly charge for a number of
 * payments from today (its first charge is made at once), then stopping and
 * restarting it. The rules behind each step (the calendar, the daily job, who
 * may stop and restart) are covered by the API test
 * (apps/api/test/charges-recurring.e2e-spec.ts).
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await db.school.update({ where: { id: s.schoolId }, data: { defaultCurrency: 'GBP', taxCountry: 'GB', taxRateBasisPoints: 2000, taxInclusive: true, timezone: 'UTC' } });
  await db.paymentAccount.create({ data: { id: randomUUID(), schoolId: s.schoolId, provider: 'CASH', accountTitle: 'Desk', country: 'GB' } });
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.chargeAllocation.deleteMany({ where });
  await db.balanceEntry.deleteMany({ where });
  await db.transaction.deleteMany({ where });
  await db.charge.deleteMany({ where });
  await db.recurringCharge.deleteMany({ where });
  await db.paymentAccount.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

test('set up a monthly recurring charge for 3 payments, then stop and restart it', async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  await page.goto(`/students/${s.student.id}`);
  const card = page.getByTestId('student-charges');
  await expect(card.getByRole('heading', { name: 'Payments' })).toBeVisible();

  await card.getByRole('button', { name: '+ Recurring charge' }).click();
  const form = page.getByTestId('create-recurring-charge-form');
  await form.getByLabel('Description').fill('Private lesson');
  await form.getByLabel('Price').fill('60');
  await form.getByLabel('How often').selectOption('MONTHLY');
  await form.getByLabel('First charge').fill(today);
  await form.getByLabel('Ends').selectOption('COUNT');
  await form.getByLabel('Number of payments').fill('3');
  // Prices include 20% tax: 50.00 + 10.00 = 60.00 each time.
  const preview = page.getByTestId('recurring-charge-preview');
  await expect(preview).toContainText('50.00 GBP');
  await expect(preview).toContainText('10.00 GBP');
  await expect(preview).toContainText('60.00 GBP');
  await form.getByRole('button', { name: 'Set up recurring charge' }).click();
  await expect(form).toHaveCount(0);

  // The first charge is made today, as a normal charge with its invoice number.
  const charge = page.getByRole('row', { name: /#0000001/ });
  await expect(charge).toContainText('Private lesson');
  await expect(charge).toContainText('Open');
  await expect(card.getByText('Owes 60.00 GBP')).toBeVisible();

  const list = page.getByTestId('recurring-charges');
  const series = list.getByRole('row', { name: /Private lesson/ });
  await expect(series).toContainText('Every month');
  await expect(series).toContainText('Payments made: 1 / 3');
  await expect(series).toContainText('Active');
  const row = await db.recurringCharge.findFirstOrThrow({ where: { schoolId: s.schoolId, studentId: s.student.id } });
  expect(row).toMatchObject({ frequency: 'MONTHLY', maxOccurrences: 3, createdCount: 1, unitAmount: 6000 });

  // Stop: no more charges; the one already made stays.
  await series.getByRole('button', { name: 'Stop' }).click();
  const stop = page.getByTestId('stop-recurring-charge-form');
  await stop.getByRole('button', { name: 'Stop recurring charge' }).click();
  await expect(stop).toHaveCount(0);
  await expect(series).toContainText('Stopped');
  await expect(charge).toContainText('Open');
  expect((await db.recurringCharge.findUniqueOrThrow({ where: { id: row.id } })).stoppedReason).toBe('STAFF');

  // Restart (the owner): active again, from its next date.
  await series.getByRole('button', { name: 'Restart' }).click();
  await expect(series).toContainText('Active');
  expect((await db.recurringCharge.findUniqueOrThrow({ where: { id: row.id } })).stoppedAt).toBeNull();
  expect(await db.charge.count({ where: { recurringChargeId: row.id } })).toBe(1);
});

test('"No tax on this item" on a recurring charge: each charge has no tax (Decision 414 item 5)', async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  await page.goto(`/students/${s.student.id}`);
  const card = page.getByTestId('student-charges');
  await card.getByRole('button', { name: '+ Recurring charge' }).click();
  const form = page.getByTestId('create-recurring-charge-form');
  await form.getByLabel('Description').fill('Kids kit');
  await form.getByLabel('Price').fill('60');
  await form.getByLabel('First charge').fill(today);
  // Prices include 20% tax, until the tick.
  const preview = page.getByTestId('recurring-charge-preview');
  await expect(preview).toContainText('10.00 GBP');
  await form.getByLabel('No tax on this item (0% or exempt)').check();
  await expect(preview).toContainText('No tax');
  await expect(preview).not.toContainText('10.00 GBP');
  await expect(form).toContainText('with its own invoice number and no tax');
  await form.getByRole('button', { name: 'Set up recurring charge' }).click();
  await expect(form).toHaveCount(0);

  const series = page.getByTestId('recurring-charges').getByRole('row', { name: /Kids kit/ });
  await expect(series).toContainText('No tax on this item (0% or exempt)');
  await expect(page.getByRole('row', { name: /#0000001/ })).toContainText('No tax');
  expect(await db.recurringCharge.findFirstOrThrow({ where: { schoolId: s.schoolId, studentId: s.student.id } })).toMatchObject({ taxExempt: true });
  expect(await db.charge.findFirstOrThrow({ where: { schoolId: s.schoolId, studentId: s.student.id } })).toMatchObject({ taxExempt: true, taxAmount: 0, netAmount: 6000, grossAmount: 6000 });
});
