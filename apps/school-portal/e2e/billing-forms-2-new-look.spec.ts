import { randomUUID } from 'crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';
import { pickOption } from './team-helpers';

/**
 * Billing forms 2 in the new look (Decisions 453, 460): the Transactions
 * page's dialogs (Mark as paid, Record a payment, Cancel payment, Refund) and
 * the membership plan form page with its contract. Each dialog's buttons sit
 * in the button band, the going-back button first and the action last, and a
 * form's band is its last child so Enter submits; no browser <select> is left;
 * a pick in one of the new look's drop-downs counts as an edit; and on a phone
 * nothing is wider than the screen.
 */

let s: GradingSchool;
let planId: string;
let accountId: string;

test.beforeEach(async () => {
  s = await seedGradingSchool();
  await db.school.update({ where: { id: s.schoolId }, data: { defaultCurrency: 'GBP' } });
  const account = await db.paymentAccount.create({ data: { id: randomUUID(), schoolId: s.schoolId, provider: 'STRIPE', accountTitle: 'Desk', country: 'GB' } });
  accountId = account.id;
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: '10-Class Pack', price: 15000, classesIncluded: 10, currency: 'GBP' },
  });
  planId = plan.id;
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

async function addCashPayment(status: 'PENDING' | 'SUCCESSFUL', daysAgo: number) {
  return db.transaction.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      studentId: s.student.id,
      paymentAccountId: accountId,
      membershipPlanId: planId,
      kind: 'MEMBERSHIP',
      amount: 15000,
      currency: 'GBP',
      status,
      paymentMethod: 'CASH',
      billingDate: new Date(Date.now() - daysAgo * 86_400_000),
    },
  });
}

/** The dialog's button band: its buttons, in order. */
function band(dialog: Locator) {
  return dialog.locator('.ultm8-modal__actions').getByRole('button');
}

/** Nothing on the page is wider than the window. */
async function fitsTheScreen(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
  expect(scroll).toBeLessThanOrEqual(width);
}

test('the Transactions dialogs: the button band last, Cancel first, no browser <select>', async ({ page }) => {
  await addCashPayment('PENDING', 2);
  await addCashPayment('SUCCESSFUL', 3);
  await signIn(page, s.ownerToken);
  await page.goto('/transactions');
  const dialog = page.getByRole('dialog');
  const pending = page.locator('tbody tr').filter({ has: page.getByRole('button', { name: 'Mark as paid' }) });

  await pending.getByRole('button', { name: 'Mark as paid' }).click();
  await expect(band(dialog)).toHaveText(['Cancel', 'Mark as paid']);
  await band(dialog).first().click();
  await expect(dialog).toHaveCount(0);

  await pending.getByRole('button', { name: 'Cancel payment' }).click();
  await expect(dialog.locator('form > .ultm8-modal__actions:last-child')).toHaveCount(1);
  await expect(band(dialog)).toHaveText(['Cancel', 'Cancel payment']);
  await band(dialog).first().click();

  await page.locator('tbody tr').getByRole('button', { name: 'Refund', exact: true }).click();
  await expect(dialog.locator('form > .ultm8-modal__actions:last-child')).toHaveCount(1);
  await expect(band(dialog)).toHaveText(['Cancel', 'Record refund']);
  await band(dialog).first().click();

  await page.getByRole('button', { name: 'Record a payment' }).click();
  await expect(dialog.locator('select')).toHaveCount(0);
  await expect(dialog.getByRole('combobox')).toHaveText([/Choose…/, /Choose…/, /Cash/]);
  await expect(band(dialog)).toHaveText(['Cancel', 'Record payment']);
});

test('Enter in the Refund amount submits the form', async ({ page }) => {
  await addCashPayment('SUCCESSFUL', 2);
  await signIn(page, s.ownerToken);
  await page.goto('/transactions');
  await page.locator('tbody tr').getByRole('button', { name: 'Refund', exact: true }).click();
  const dialog = page.getByRole('dialog');
  // The required note is still empty: Enter submits, and the form says why it can't.
  await dialog.getByLabel('Amount given back').press('Enter');
  await expect(dialog.getByText('Add a note about this refund.')).toBeVisible();
});

test('in Record a payment a pick counts as an edit: Escape no longer closes it', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/transactions');
  const dialog = page.getByRole('dialog');

  // Untouched, Escape closes it.
  await page.getByRole('button', { name: 'Record a payment' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Record a payment' }).click();
  await pickOption(dialog, 'Student', 'Sam Lee');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await band(dialog).first().click();
  await expect(dialog).toHaveCount(0);
});

test('the plan form: the new header, its steps as pills, no browser <select> on any step', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/membership-plans/new');
  await expect(page.locator('.u8n-page-header').getByRole('heading', { name: 'Add membership plan' })).toBeVisible();
  await expect(page.locator('.ultm8-page-header')).toHaveCount(0);
  await expect(page.locator('.ultm8-card')).toHaveCount(0);

  const steps = ['1. Basics', '2. Pricing & Access', '3. Policies', '4. Disciplines & Lessons', '5. Visibility'];
  for (const step of steps) {
    await page.getByRole('button', { name: step }).click();
    await expect(page.getByRole('button', { name: step })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.u8n-page select')).toHaveCount(0);
  }
  // Back and Cancel first; Save last.
  await expect(page.locator('form .u8f-actions').getByRole('button')).toHaveText(['Back', 'Cancel', 'Save']);

  // Type is one of the new look's drop-downs; the Class Pack's fields follow it.
  await page.getByRole('button', { name: '1. Basics' }).click();
  await pickOption(page, 'Type', 'Class Pack');
  await page.getByRole('button', { name: '2. Pricing & Access' }).click();
  await expect(page.getByRole('combobox', { name: 'Scoped to Class', exact: true })).toBeVisible();
  await expect(page.getByLabel(/Classes included/)).toBeVisible();
});

test('a Subscription plan: the billing choice as pills, the contract on its own sheet', async ({ page }) => {
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: 'Monthly', price: 5000, currency: 'GBP' } });
  await signIn(page, s.ownerToken);
  await page.goto(`/membership-plans/${plan.id}/edit`);
  await page.getByRole('button', { name: '2. Pricing & Access' }).click();
  const choice = page.getByRole('group', { name: 'New member billing' });
  await expect(choice.getByRole('button', { name: 'Fresh cycle from signup day' })).toHaveAttribute('aria-pressed', 'true');
  await choice.getByRole('button', { name: 'Prorate to a shared renewal day' }).click();
  await expect(choice.getByRole('button', { name: 'Prorate to a shared renewal day' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Renewal day of month')).toBeVisible();

  const contract = page.getByRole('form', { name: 'Contract' });
  await expect(contract).toHaveClass(/u8f-sheet/);
  await expect(contract.locator('.u8f-actions').getByRole('button')).toHaveText(['Add contract']);
  await expect(page.locator('.u8n-page select')).toHaveCount(0);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the plan form and the Record a payment dialog fit a phone', async ({ page }) => {
    const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: 'Monthly', price: 5000, currency: 'GBP' } });
    await signIn(page, s.ownerToken);
    await page.goto(`/membership-plans/${plan.id}/edit`);
    await expect(page.getByRole('button', { name: '5. Visibility' })).toBeVisible();
    for (const step of ['1. Basics', '2. Pricing & Access', '3. Policies']) {
      await page.getByRole('button', { name: step }).click();
      await fitsTheScreen(page);
    }

    await page.goto('/transactions');
    await page.getByRole('button', { name: 'Record a payment' }).click();
    const dialog = page.getByRole('dialog');
    await pickOption(dialog, 'Plan', '10-Class Pack (150.00 GBP)');
    await fitsTheScreen(page);
    // The band stays in view at the foot of the screen, its buttons side by side.
    const buttons = band(dialog);
    await expect(buttons).toHaveCount(2);
    for (const b of await buttons.all()) {
      const box = (await b.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      expect(box.y + box.height).toBeLessThanOrEqual(844);
    }
  });
});
