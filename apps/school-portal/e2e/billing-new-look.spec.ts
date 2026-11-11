import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The Billing pages in the new look (Decision 453): Membership plans,
 * Transactions, Billing reports and Payroll. The page header and stat rows,
 * our own drop-downs instead of browser selects (DESIGN.md → "Drop-downs"),
 * the page tabs in the header, and on a phone Export CSV under ⋯ More
 * (DESIGN.md → "Phone layout"). What the pages show and do is covered by
 * their own specs (transactions, membership-plans, payroll,
 * charges-refunds-reports, decision-448-money).
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool();
  const account = await db.paymentAccount.create({ data: { id: randomUUID(), schoolId: s.schoolId, provider: 'STRIPE', accountTitle: 'Desk', country: 'GB' } });
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: '10-Class Pack', price: 15000, classesIncluded: 10, currency: 'GBP' },
  });
  for (const [status, daysAgo] of [
    ['SUCCESSFUL', 1],
    ['PENDING', 2],
  ] as const) {
    await db.transaction.create({
      data: {
        id: randomUUID(),
        schoolId: s.schoolId,
        studentId: s.student.id,
        paymentAccountId: account.id,
        membershipPlanId: plan.id,
        kind: 'MEMBERSHIP',
        amount: 15000,
        currency: 'GBP',
        status,
        paymentMethod: 'CASH',
        billingDate: new Date(Date.now() - daysAgo * 86_400_000),
      },
    });
  }
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

test('Transactions: the new header, a stat row and our own drop-downs that filter the rows', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/transactions');
  await expect(page.locator('.u8n-page-header').getByRole('heading', { name: 'Transactions' })).toBeVisible();
  await expect(page.locator('.u8b-stats')).toContainText(/Total transactions\s*2/);
  await expect(page.locator('tbody tr')).toHaveCount(2);

  // No browser <select> on the page: every filter is a combobox with a listbox.
  await expect(page.locator('main select, .u8n-content select')).toHaveCount(0);
  const status = page.getByRole('combobox', { name: 'Status', exact: true });
  await expect(status.locator('[data-shown="true"]')).toHaveText('Any');
  await expect(status).toHaveAttribute('aria-expanded', 'false');
  await status.click();
  const list = page.getByRole('listbox', { name: 'Status' });
  await expect(list.getByRole('option', { name: 'Any', exact: true })).toHaveAttribute('aria-selected', 'true');
  await list.getByRole('option', { name: 'Pending', exact: true }).click();
  await expect(list).toHaveCount(0);
  await expect(status.locator('[data-shown="true"]')).toHaveText('Pending');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('.u8b-stats')).toContainText(/Total transactions\s*1/);

  // The keyboard works too: open, move down, pick.
  await status.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox', { name: 'Status' })).toBeVisible();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(status.locator('[data-shown="true"]')).toHaveText('Any');
  await expect(page.locator('tbody tr')).toHaveCount(2);
});

test('Billing reports and Payroll: the page tabs sit in the header', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/billing-reports');
  const tabs = page.locator('.u8b-head').getByRole('tablist');
  await expect(tabs.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  await tabs.getByRole('tab', { name: 'Member balances' }).click();
  await expect(tabs.getByRole('tab', { name: 'Member balances' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('member-balances')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Show', exact: true })).toBeVisible();

  await page.goto('/payroll');
  const payrollTabs = page.locator('.u8b-head').getByRole('tablist');
  await expect(payrollTabs.getByRole('tab', { name: 'Report' })).toHaveAttribute('aria-selected', 'true');
  await payrollTabs.getByRole('tab', { name: 'Rates' }).click();
  await expect(page.getByTestId('payroll-rates')).toBeVisible();
});

test('Membership plans: the stat row and the plans list card', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/membership-plans');
  await expect(page.locator('.u8n-page-header').getByRole('heading', { name: 'Membership Plans' })).toBeVisible();
  await expect(page.getByTestId('stat-tile-Total plans').locator('span').nth(1)).toHaveText('1');
  await expect(page.locator('.u8b-card').getByRole('row', { name: /10-Class Pack/ }).getByRole('button', { name: 'Edit' })).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Export CSV sits under ⋯ More and still downloads', async ({ page }) => {
    await signIn(page, s.ownerToken);
    await page.goto('/transactions');
    await expect(page.getByRole('button', { name: 'Record a payment' })).toBeVisible();
    const exportButton = page.getByRole('button', { name: 'Export CSV' });
    await expect(exportButton).toBeHidden();
    const more = page.getByRole('button', { name: 'More actions' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(exportButton).toBeVisible();
    const download = page.waitForEvent('download');
    await exportButton.click();
    expect((await download).suggestedFilename()).toMatch(/^transactions-\d{4}-\d{2}-\d{2}\.csv$/);
    // Nothing wider than the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
