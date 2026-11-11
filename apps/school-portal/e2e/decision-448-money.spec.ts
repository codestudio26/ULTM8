import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'crypto';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/** Picks an option in one of the new look's own drop-downs (DESIGN.md →
 * "Drop-downs"): a combobox named by its label, then the option by its text. */
async function choose(scope: Page | Locator, label: string, option: string) {
  const field = scope.getByRole('combobox', { name: label, exact: true });
  await field.click();
  await scope.getByRole('option', { name: option, exact: true }).click();
  await expect(field.locator('[data-shown="true"]')).toHaveText(option);
}

/**
 * Decision 448 on the School Portal: the card surcharge as its own line in
 * revenue, on the Transactions page and the billing overview alike (item 1);
 * no-show fees as rows of the Transactions page (item 18); Pix shown nowhere
 * outside Brazil (item 5).
 */
let s: GradingSchool;
let accountId: string;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // Sam Lee and Nia Park enrolled; a UK School
  await db.school.update({ where: { id: s.schoolId }, data: { defaultCurrency: 'GBP' } });
  accountId = (await db.paymentAccount.create({ data: { id: randomUUID(), schoolId: s.schoolId, provider: 'STRIPE', accountTitle: 'Card', country: 'GB' } })).id;
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.transaction.deleteMany({ where });
  await db.booking.deleteMany({ where });
  await db.class.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
  await db.paymentAccount.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

async function seedPayments() {
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: '10 classes', price: 5000, classesIncluded: 10, currency: 'GBP' } });
  const row = { schoolId: s.schoolId, studentId: s.student.id, paymentAccountId: accountId, currency: 'GBP', status: 'SUCCESSFUL' as const, paymentMethod: 'STRIPE' as const };
  // A card purchase: 50.00 and a 1.50 card surcharge.
  await db.transaction.create({ data: { ...row, id: randomUUID(), membershipPlanId: plan.id, kind: 'MEMBERSHIP', amount: 5000, surchargeAmount: 150 } });
  // A no-show fee charged to the saved card.
  const cls = await db.class.create({ data: { id: randomUUID(), schoolId: s.schoolId, title: 'Tuesday Fundamentals', startDate: new Date(Date.now() - 3 * 3_600_000), endDate: new Date(Date.now() - 2 * 3_600_000) } });
  const booking = await db.booking.create({
    data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, status: 'NO_SHOW', noShowFeeOutcome: 'CHARGED', noShowFeeAmount: 800 },
  });
  await db.transaction.create({ data: { ...row, id: randomUUID(), kind: 'NO_SHOW_FEE', bookingId: booking.id, amount: 800 } });
}

test('Transactions: the card surcharge is its own tile, and a no-show fee is a row naming its class', async ({ page }) => {
  await seedPayments();
  await signIn(page, s.ownerToken);
  await page.goto('/transactions');
  const tile = (label: string, value: string) => expect(page.getByText(new RegExp(`^${label}\\s*${value}$`))).toBeVisible();
  // The price of what was sold: 50.00 + 8.00; the surcharge apart.
  await tile('Total revenue', '58\\.00 GBP');
  await tile('Card surcharges', '1\\.50 GBP');
  await expect(page.locator('tbody tr').filter({ hasText: 'No-show fee: Tuesday Fundamentals' })).toContainText('8.00');

  await choose(page, 'Type', 'No-show fee');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await tile('Total revenue', '8\\.00 GBP');
  // No surcharge on a no-show fee: no tile.
  await expect(page.getByText(/^Card surcharges/)).toHaveCount(0);

  // Pix is not a method a UK School's payments can be filtered by.
  await page.getByRole('combobox', { name: 'Method', exact: true }).click();
  const methods = page.getByRole('listbox', { name: 'Method' });
  await expect(methods.getByRole('option', { name: 'Cash', exact: true })).toBeVisible();
  await expect(methods.getByRole('option', { name: 'Pix', exact: true })).toHaveCount(0);
});

test('Billing reports: the card surcharge is its own line, in the total too, and agrees with the Transactions page', async ({ page }) => {
  await seedPayments();
  await signIn(page, s.ownerToken);
  await page.goto('/billing-reports');
  const overview = page.getByTestId('charge-overview');
  // Decision 449 item 10: the no-show fee is on its own "Fees" line, not in Memberships.
  await expect(overview).toContainText('Memberships50.00 GBP');
  await expect(overview).toContainText('Fees8.00 GBP');
  await expect(overview).toContainText('Card surcharges1.50 GBP');
  await expect(overview).toContainText('Total revenue59.50 GBP');
  const rows = overview.getByRole('row');
  await expect(rows.nth(0)).toHaveText(/Month\s*Received\s*Given back\s*Charges\s*Memberships\s*Fees\s*Card surcharges\s*Total/);
  await expect(rows.nth(1)).toContainText(/50\.00 GBP\s*8\.00 GBP\s*1\.50 GBP\s*59\.50 GBP/);
});

test('Pix only in Brazil: the desk sale and Record a payment offer it to a Brazilian School only, and say so', async ({ page }) => {
  await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: 'Ten classes', price: 6000, classesIncluded: 10, currency: 'GBP' } });
  await signIn(page, s.ownerToken);
  // A UK School pricing in reais is still not in Brazil.
  await db.school.update({ where: { id: s.schoolId }, data: { addressCountry: 'GB', defaultCurrency: 'BRL' } });
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Record a payment' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('cash, bank transfer or your card terminal');
  await expect(dialog).not.toContainText('Pix');
  await expect(dialog.locator('option[value="PIX"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await db.school.update({ where: { id: s.schoolId }, data: { addressCountry: 'BR' } });
  await page.goto(`/students/${s.student.id}`);
  await page.getByRole('button', { name: 'Sell a plan' }).click();
  await expect(page.locator('#desk-paid-by option')).toHaveText(['Cash', 'Bank transfer', 'Pix', 'Card terminal']);
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Record a payment' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('cash, bank transfer, Pix or your card terminal');
});
