import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Late fees (v1.3 backlog §3.7; Decision 413), the owner's side: the School
 * page's "Late fees" card (off by default, saving it on needs the legal
 * confirmation) and waiving a late fee on the student's Payments card. The
 * late fee itself is added by the daily job, so it is written straight to the
 * database here; the job's rules are covered by the API test
 * (apps/api/test/late-fees.e2e-spec.ts).
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
  await db.charge.deleteMany({ where: { ...where, lateFeeForChargeId: { not: null } } });
  await db.charge.deleteMany({ where });
  await db.paymentAccount.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

test('off by default; the owner switches late fees on only after confirming they are legal', async ({ page }) => {
  await page.goto('/school');
  const card = page.locator('form#late-fees');
  await expect(card.getByRole('heading', { name: 'Late fees' })).toBeVisible();
  await expect(card.getByLabel('Add late fees')).not.toBeChecked();
  await expect(card.getByLabel('Grace days')).toHaveValue('3');

  await card.getByLabel('Add late fees').check();
  await card.getByLabel('Late fee', { exact: true }).selectOption('PERCENT');
  await card.getByLabel('Percentage (%)').fill('2.555');
  await expect(card.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await card.getByLabel('I confirm late fees are legal where my School operates').check();
  await card.getByRole('button', { name: 'Save changes' }).click();
  await expect(card.getByText('Enter a percentage above 0 and up to 100, with at most two decimals.').first()).toBeVisible();
  await card.getByLabel('Percentage (%)').fill('2.5');
  await card.getByLabel('Grace days').fill('5');
  await card.getByRole('button', { name: 'Save changes' }).click();
  await expect(card.getByText('Saved.')).toBeVisible();
  const school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(school).toMatchObject({ lateFeeEnabled: true, lateFeeType: 'PERCENT', lateFeePercentBps: 250, lateFeeGraceDays: 5 });
  expect(school.lateFeeConfirmedAt).not.toBeNull();
  expect(school.lateFeeEnabledAt).not.toBeNull();
});

test('a late fee shows with a "Late fee" badge and what it is for, and the owner waives it', async ({ page }) => {
  const overdueId = randomUUID();
  const feeId = randomUUID();
  const base = { schoolId: s.schoolId, studentId: s.student.id, taxRateBasisPoints: 0, taxInclusive: true, discountAmount: 0, taxAmount: 0, currency: 'GBP' };
  await db.charge.create({
    data: { ...base, id: overdueId, invoiceNumber: 1, description: 'Rash guard', unitAmount: 4000, netAmount: 4000, grossAmount: 4000, dueDate: new Date('2026-10-01') },
  });
  await db.charge.create({
    data: {
      ...base,
      id: feeId,
      invoiceNumber: 2,
      description: 'Late fee: invoice #0000001',
      unitAmount: 1500,
      netAmount: 1500,
      grossAmount: 1500,
      dueDate: new Date('2026-10-05'),
      lateFeeForChargeId: overdueId,
      lateFeeOverdueAmount: 4000,
    },
  });
  await db.balanceEntry.createMany({
    data: [
      { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, kind: 'CHARGE', amount: 4000, currency: 'GBP', chargeId: overdueId },
      { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, kind: 'CHARGE', amount: 1500, currency: 'GBP', chargeId: feeId },
    ],
  });

  await page.goto(`/students/${s.student.id}`);
  const card = page.getByTestId('student-charges');
  await expect(card.getByText('Owes 55.00 GBP')).toBeVisible();
  const row = page.getByRole('row', { name: /#0000002/ });
  await expect(row).toContainText('Late fee');
  await expect(row).toContainText('For invoice #0000001 (Rash guard)');
  // A late fee is waived, not cancelled with a reason.
  await expect(row.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Waive' }).click();
  const dialog = page.getByTestId('waive-late-fee-form');
  await expect(dialog).toContainText('15.00 GBP');
  await dialog.getByRole('button', { name: 'Waive late fee' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText('Cancelled');
  await expect(row).toContainText('Waived on');
  await expect(card.getByText('Owes 40.00 GBP')).toBeVisible();
  const waived = await db.charge.findUniqueOrThrow({ where: { id: feeId } });
  expect(waived).toMatchObject({ lateFeeWaived: true, cancelReason: null });
  expect(waived.cancelledAt).not.toBeNull();
});
