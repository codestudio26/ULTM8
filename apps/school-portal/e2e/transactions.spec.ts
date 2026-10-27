import { expect, test } from '@playwright/test';
import { randomUUID } from 'crypto';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The Transactions page after the 26 Oct review (Decision 339): the whole
 * ledger newest first with Prev/Next, tiles counted on the server, Mark as
 * paid / Cancel on Pending cash rows, Receipt on card rows only, and a message
 * (not a blank page) for someone with no School of their own.
 */
let s: GradingSchool;
let planId: string;
let accountId: string;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // Sam Lee and Nia Park enrolled
  // One payment account per School; each row records how it was paid.
  const account = await db.paymentAccount.create({ data: { id: randomUUID(), schoolId: s.schoolId, provider: 'STRIPE', accountTitle: 'Desk', country: 'GB' } });
  accountId = account.id;
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: '10-Class Pack', price: 15000, classesIncluded: 10, currency: 'GBP' },
  });
  planId = plan.id;
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

async function addTransaction(opts: {
  studentId?: string;
  status: 'SUCCESSFUL' | 'PENDING' | 'FAILED' | 'REFUNDED' | 'DISPUTED';
  method?: 'CASH' | 'STRIPE';
  amount?: number;
  currency?: string;
  daysAgo: number;
}) {
  return db.transaction.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      studentId: opts.studentId ?? s.student.id,
      paymentAccountId: accountId,
      membershipPlanId: planId,
      amount: opts.amount ?? 15000,
      currency: opts.currency ?? 'GBP',
      status: opts.status,
      paymentMethod: opts.method ?? 'CASH',
      billingDate: new Date(Date.now() - opts.daysAgo * 86_400_000),
    },
  });
}

test('lists every payment newest first, 20 a page, with tiles for the whole ledger', async ({ page }) => {
  // 23 Successful payments 1..23 days ago (£1.00 each, the newest worth £23),
  // plus one Pending and one Failed payment older than all of them.
  for (let d = 1; d <= 23; d++) await addTransaction({ status: 'SUCCESSFUL', amount: 100 * (24 - d), daysAgo: d });
  await addTransaction({ status: 'PENDING', daysAgo: 40 });
  await addTransaction({ status: 'FAILED', daysAgo: 41 });

  await signIn(page, s.ownerToken);
  await page.goto('/transactions');
  await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

  // A tile reads as its label then its value ("Successful23").
  const tile = (label: string, value: string) => expect(page.getByText(new RegExp(`^${label}\\s*${value}$`))).toBeVisible();
  await tile('Total transactions', '25');
  await tile('Successful', '23');
  await tile('Waiting for payment', '1');
  await tile('Failed / disputed', '1');
  // £1 + £2 + … + £23 = £276, Successful only.
  await tile('Total revenue', '276\\.00 GBP');

  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(20);
  await expect(rows.first()).toContainText('23.00');
  await expect(rows.first()).toContainText('10-Class Pack');
  await expect(page.getByText('Page 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prev' })).toBeDisabled();

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Page 2')).toBeVisible();
  await expect(rows).toHaveCount(5);
  await expect(rows.last()).toContainText('Failed');
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();

  await page.getByRole('button', { name: 'Prev' }).click();
  await expect(page.getByText('Page 1')).toBeVisible();
  await expect(rows.first()).toContainText('23.00');
});

test('Receipt shows on card payments only; Mark as paid starts the membership', async ({ page }) => {
  await addTransaction({ status: 'SUCCESSFUL', method: 'STRIPE', daysAgo: 2 });
  const pending = await addTransaction({ status: 'PENDING', daysAgo: 1 });

  await signIn(page, s.ownerToken);
  await page.goto('/transactions');
  const cardRow = page.locator('tbody tr').nth(1);
  const cashRow = page.locator('tbody tr').first();
  await expect(cardRow.getByRole('button', { name: 'Receipt' })).toBeVisible();
  await expect(cardRow.getByRole('button', { name: 'Mark as paid' })).toHaveCount(0);
  await expect(cashRow.getByRole('button', { name: 'Receipt' })).toHaveCount(0);

  await cashRow.getByRole('button', { name: 'Mark as paid' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Sam Lee');
  await dialog.getByRole('button', { name: 'Mark as paid' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(cashRow).toContainText('Successful');
  await expect(cashRow.getByRole('button', { name: 'Mark as paid' })).toHaveCount(0);
  const settled = await db.transaction.findUniqueOrThrow({ where: { id: pending.id } });
  expect(settled.status).toBe('SUCCESSFUL');
  expect(settled.membershipId).not.toBeNull();
  await expect(page.getByText(/^Waiting for payment\s*0$/)).toBeVisible();
});

test('Cancel payment asks first and marks it Failed with no membership', async ({ page }) => {
  const pending = await addTransaction({ status: 'PENDING', daysAgo: 1 });

  await signIn(page, s.ownerToken);
  await page.goto('/transactions');
  const row = page.locator('tbody tr').first();
  await row.getByRole('button', { name: 'Cancel payment' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Back' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await db.transaction.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('PENDING');

  await row.getByRole('button', { name: 'Cancel payment' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel payment' }).click();
  await expect(row).toContainText('Failed');
  const cancelled = await db.transaction.findUniqueOrThrow({ where: { id: pending.id } });
  expect(cancelled).toMatchObject({ status: 'FAILED', membershipId: null });
});

test('confirming for a student who has left shows why', async ({ page }) => {
  await addTransaction({ status: 'PENDING', daysAgo: 1 });
  await db.roleGrant.updateMany({ where: { userId: s.student.id, schoolId: s.schoolId, role: 'STUDENT' }, data: { revokedAt: new Date() } });

  await signIn(page, s.ownerToken);
  await page.goto('/transactions');
  await page.locator('tbody tr').first().getByRole('button', { name: 'Mark as paid' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Mark as paid' }).click();
  await expect(dialog).toContainText('has left the School');
});

test('Branch Staff see a message instead of a blank page', async ({ page }) => {
  const staff = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId }]);
  await signIn(page, staff.token);
  await page.goto('/transactions');
  await expect(page.getByText('Only the School owner can see transactions')).toBeVisible();
});
