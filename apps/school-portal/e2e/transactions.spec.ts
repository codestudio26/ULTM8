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
  kind?: 'MEMBERSHIP' | 'RENEWAL' | 'LATE_CANCEL_FEE';
}) {
  return db.transaction.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      studentId: opts.studentId ?? s.student.id,
      paymentAccountId: accountId,
      membershipPlanId: opts.kind === 'LATE_CANCEL_FEE' ? null : planId,
      kind: opts.kind ?? 'MEMBERSHIP',
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

/** Decision 346: renewals and late-cancel fees as their own rows, filters that
 * narrow the rows and the tiles, a CSV of everything filtered, and Record a
 * payment for cash taken at the desk. */
test('renewal and late-cancel fee rows are labelled, and the filters narrow rows and tiles', async ({ page }) => {
  await addTransaction({ status: 'SUCCESSFUL', method: 'STRIPE', daysAgo: 1, kind: 'RENEWAL' });
  await addTransaction({ status: 'FAILED', method: 'STRIPE', amount: 500, daysAgo: 2, kind: 'LATE_CANCEL_FEE' });
  await addTransaction({ status: 'SUCCESSFUL', daysAgo: 40 });

  await signIn(page, s.ownerToken);
  await page.goto('/transactions');
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Renewal: 10-Class Pack');
  await expect(rows.nth(1)).toContainText('Late-cancellation fee');

  await page.getByLabel('Type').selectOption('LATE_CANCEL_FEE');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('5.00');
  await expect(page.getByText(/^Total transactions\s*1$/)).toBeVisible();
  await expect(page.getByText(/^Failed \/ disputed\s*1$/)).toBeVisible();

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(rows).toHaveCount(3);
  // The last 30 days only: the 40-day-old payment drops out.
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('From').fill(since);
  await expect(rows).toHaveCount(2);
  await expect(page.getByText(/^Total transactions\s*2$/)).toBeVisible();

  await page.getByLabel('Status').selectOption('PENDING');
  await expect(page.getByText('No Transactions match these filters')).toBeVisible();
});

test('Export CSV downloads every filtered row', async ({ page }) => {
  await addTransaction({ status: 'SUCCESSFUL', daysAgo: 1 });
  await addTransaction({ status: 'FAILED', method: 'STRIPE', amount: 500, daysAgo: 2, kind: 'LATE_CANCEL_FEE' });

  await signIn(page, s.ownerToken);
  await page.goto('/transactions');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^transactions-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = (await import('fs')).readFileSync((await file.path())!, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.trim().split('\r\n');
  expect(lines[0]).toBe('Date,Student,Plan,Type,Amount,Currency,Status,Method,Refunded,Disputed,Transaction ID');
  expect(lines).toHaveLength(3);
  expect(lines[1]).toContain('Sam Lee,10-Class Pack,Membership,150.00,GBP,Successful');
  expect(lines[2]).toContain('Late-cancellation fee,5.00,GBP,Failed');
});

test('Record a payment starts the membership and shows the row as taken at the desk', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Record a payment' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Record payment' })).toBeDisabled();
  await dialog.getByLabel('Student').selectOption({ label: 'Sam Lee' });
  await dialog.getByLabel('Plan').selectOption(planId);
  await dialog.getByLabel('Method').selectOption('BANK_TRANSFER');
  await dialog.getByRole('button', { name: /^Record .*150\.00/ }).click();
  await expect(dialog).toHaveCount(0);

  const row = page.locator('tbody tr').first();
  await expect(row).toContainText('Successful');
  await expect(row).toContainText('at desk');
  const saved = await db.transaction.findFirstOrThrow({ where: { schoolId: s.schoolId } });
  expect(saved).toMatchObject({ studentId: s.student.id, status: 'SUCCESSFUL', paymentMethod: 'BANK_TRANSFER', recordedById: s.ownerId });
  expect(saved.membershipId).not.toBeNull();
});

/** Decision 347: the owner's switch on the School page lets Branch Staff use
 * Record a payment, for their own branch's students only, without the ledger. */
test('the owner can let Branch Staff record desk payments from the School page', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/school');
  const box = page.getByLabel('Let Branch Staff record payments taken at the desk');
  await expect(box).not.toBeChecked();
  await box.check();
  await page.getByRole('button', { name: 'Save changes' }).first().click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  expect((await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).branchStaffCanRecordPayments).toBe(true);
});

test('Branch Staff with the switch on record a payment for a student of their branch', async ({ page }) => {
  await db.school.update({ where: { id: s.schoolId }, data: { branchStaffCanRecordPayments: true } });
  const branch = await db.branch.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'North' } });
  await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, branchId: branch.id } });
  const staff = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: branch.id }]);

  await signIn(page, staff.token);
  await page.goto('/coach');
  await page.getByRole('link', { name: 'Record a payment' }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(page.locator('table')).toHaveCount(0);
  await page.getByRole('button', { name: 'Record a payment' }).click();
  const dialog = page.getByRole('dialog');
  const studentPicker = dialog.getByLabel('Student');
  // Nia Park has no home branch, so she isn't this branch's to record for.
  await expect(studentPicker.locator('option')).toHaveText(['Choose…', 'Sam Lee']);
  await studentPicker.selectOption({ label: 'Sam Lee' });
  await dialog.getByLabel('Plan').selectOption(planId);
  await dialog.getByRole('button', { name: /^Record .*150\.00/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Payment recorded. The membership has started.')).toBeVisible();

  const saved = await db.transaction.findFirstOrThrow({ where: { schoolId: s.schoolId } });
  expect(saved).toMatchObject({ studentId: s.student.id, status: 'SUCCESSFUL', paymentMethod: 'CASH', recordedById: staff.id });
});
