import { randomUUID } from 'crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';
import { pickOption } from './team-helpers';

/**
 * The billing dialogs opened from the student page in the new look
 * (Decisions 453, 460): the Payments card's (create charge, recurring charge,
 * record payment, refund, add credit, cancel charge, stop recurring) and the
 * Memberships card's (sell a plan, give a Friend Pass, freeze), in the shared
 * new-look dialog with its button band (Cancel first) and the new look's own
 * drop-downs. Look only: the same fields, amounts and API calls, which the
 * money specs (charges, charges-recurring, charges-refunds-reports,
 * membership-desk, membership-freeze, late-fees, card-surcharge,
 * decision-448-money, income-categories) still cover.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await db.school.update({ where: { id: s.schoolId }, data: { defaultCurrency: 'GBP', taxCountry: 'GB', taxRateBasisPoints: 2000, taxInclusive: false, timezone: 'UTC' } });
  await db.paymentAccount.create({ data: { id: randomUUID(), schoolId: s.schoolId, provider: 'CASH', accountTitle: 'Desk', country: 'GB' } });
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.chargeAllocation.deleteMany({ where });
  await db.balanceEntry.deleteMany({ where });
  await db.chargeRefund.deleteMany({ where });
  await db.membershipFreeze.deleteMany({ where });
  await db.transaction.deleteMany({ where });
  await db.charge.deleteMany({ where });
  await db.recurringCharge.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
  await db.paymentAccount.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

/** A dialog in the new look: no browser drop-down, and its buttons in the band at its foot. */
async function expectNewLook(dialog: Locator, buttons: string[]) {
  await expect(dialog.locator('select')).toHaveCount(0);
  await expect(dialog.locator('.ultm8-modal__actions').getByRole('button')).toHaveText(buttons);
}

function dialogNamed(page: Page, name: string | RegExp) {
  return page.getByRole('dialog', { name });
}

test('the Payments card\'s dialogs: new-look drop-downs, the preview card and the button band, Cancel first', async ({ page }) => {
  await page.goto(`/students/${s.student.id}`);
  const card = page.getByTestId('student-charges');

  // Create charge: a drop-down pick counts as an edit, so an outside click keeps the dialog.
  await card.getByRole('button', { name: '+ Create charge' }).click();
  const create = dialogNamed(page, /^Create charge for/);
  await expectNewLook(create, ['Cancel', 'Create charge']);
  await pickOption(create, 'Discount', 'Percentage (%)');
  await page.mouse.click(5, 5);
  await expect(create).toBeVisible();
  await create.getByLabel('Description').fill('Rash guard');
  await create.getByLabel('Price').fill('100');
  await create.getByLabel('Discount amount').fill('10');
  // 100.00 less 10% = 90.00, plus 20% tax = 108.00, in the calm preview card.
  const preview = create.getByTestId('charge-preview');
  await expect(preview).toHaveClass(/u8bd-preview/);
  await expect(preview).toContainText('90.00 GBP');
  await expect(preview).toContainText('18.00 GBP');
  await expect(preview).toContainText('108.00 GBP');
  await create.getByRole('button', { name: 'Create charge' }).click();
  await expect(create).toHaveCount(0);
  await expect(page.getByTestId('charge-balance')).toContainText('Owes 108.00 GBP');

  // Record payment: "Paid toward" and "Paid by" are the new look's drop-downs.
  const row = page.getByRole('row', { name: /Rash guard/ });
  await row.getByRole('button', { name: 'Pay' }).click();
  const pay = dialogNamed(page, /^Record payment for/);
  await expectNewLook(pay, ['Cancel', 'Record payment']);
  await expect(pay.getByRole('combobox', { name: 'Paid toward', exact: true }).locator('[data-shown="true"]')).toContainText('Rash guard');
  await expect(pay.getByLabel('Amount received')).toHaveValue('108');
  await pickOption(pay, 'Paid by', 'Bank transfer');
  await pay.getByRole('button', { name: 'Record payment' }).click();
  await expect(pay).toHaveCount(0);
  const tx = await db.transaction.findFirstOrThrow({ where: { schoolId: s.schoolId, studentId: s.student.id } });
  expect(tx).toMatchObject({ amount: 10800, paymentMethod: 'BANK_TRANSFER' });

  // Refund: where the money goes is the new look's drop-down.
  await page.getByRole('row', { name: /Bank transfer/ }).getByRole('button', { name: 'Refund' }).click();
  const refund = dialogNamed(page, /^Refund payment of/);
  await expectNewLook(refund, ['Cancel', 'Refund']);
  await expect(refund.getByRole('combobox', { name: 'Where the money goes', exact: true })).toBeVisible();
  await refund.getByRole('button', { name: 'Cancel' }).click();
  await expect(refund).toHaveCount(0);

  // Add credit.
  await card.getByRole('button', { name: 'Add credit' }).click();
  const credit = dialogNamed(page, /^Add credit for/);
  await expectNewLook(credit, ['Cancel', 'Add credit']);
  await credit.getByRole('button', { name: 'Cancel' }).click();

  // Recurring charge: four drop-downs, none a browser <select>.
  await card.getByRole('button', { name: '+ Recurring charge' }).click();
  const recurring = dialogNamed(page, /^Recurring charge for/);
  await expectNewLook(recurring, ['Cancel', 'Set up recurring charge']);
  await expect(recurring.getByRole('combobox')).toHaveCount(3);
  await recurring.getByRole('button', { name: 'Cancel' }).click();
});

test('Cancel charge and Stop recurring charge ask first, keeping it on the left', async ({ page }) => {
  await page.goto(`/students/${s.student.id}`);
  const card = page.getByTestId('student-charges');
  await card.getByRole('button', { name: '+ Create charge' }).click();
  const create = page.getByTestId('create-charge-form');
  await create.getByLabel('Description').fill('Belt');
  await create.getByLabel('Price').fill('20');
  await create.getByRole('button', { name: 'Create charge' }).click();
  await expect(create).toHaveCount(0);

  await page.getByRole('row', { name: /Belt/ }).getByRole('button', { name: 'Cancel', exact: true }).click();
  const cancel = dialogNamed(page, /^Cancel #/);
  await expectNewLook(cancel, ['Keep charge', 'Cancel charge']);
  await cancel.getByRole('button', { name: 'Keep charge' }).click();
  await expect(cancel).toHaveCount(0);

  const today = new Date().toISOString().slice(0, 10);
  await card.getByRole('button', { name: '+ Recurring charge' }).click();
  const form = page.getByTestId('create-recurring-charge-form');
  await form.getByLabel('Description').fill('Private lesson');
  await form.getByLabel('Price').fill('60');
  await form.getByLabel('First charge').fill(today);
  await form.getByRole('button', { name: 'Set up recurring charge' }).click();
  await expect(form).toHaveCount(0);
  await page.getByTestId('recurring-charges').getByRole('button', { name: 'Stop', exact: true }).click();
  const stop = dialogNamed(page, /^Stop Private lesson/);
  await expectNewLook(stop, ['Keep it', 'Stop recurring charge']);
  await stop.getByRole('button', { name: 'Keep it' }).click();
  await expect(stop).toHaveCount(0);
});

test('the Memberships card\'s dialogs: sell a plan, give a Friend Pass and freeze', async ({ page }) => {
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, title: 'Four weeks', type: 'WEEKLY_PASS', price: 4000, currency: 'GBP', expiryDurationDays: 28 },
  });
  await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, title: 'Bring a friend', type: 'FRIEND_PASS', price: 0, classesIncluded: 1, currency: 'GBP' } });
  await db.membership.create({
    data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: plan.id, schoolId: s.schoolId, frequency: 'ONE_TIME', expiryDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000) },
  });
  await page.goto(`/students/${s.student.id}`);

  await page.getByRole('button', { name: 'Sell a plan' }).click();
  const sell = page.getByRole('dialog');
  await expectNewLook(sell, ['Cancel', 'Record sale']);
  await expect(sell.getByRole('combobox', { name: 'Plan', exact: true }).locator('[data-shown="true"]')).toHaveText('Four weeks (40.00 GBP)');
  await expect(sell.getByRole('combobox', { name: 'Paid by', exact: true })).toBeVisible();
  await sell.getByRole('button', { name: 'Cancel' }).click();
  await expect(sell).toHaveCount(0);

  await page.getByRole('button', { name: 'Give a Friend Pass' }).click();
  const gift = page.getByRole('dialog');
  await expectNewLook(gift, ['Cancel', 'Give pass']);
  await pickOption(gift, 'How many passes', '2');
  // A pick is an edit: an outside click keeps the dialog.
  await page.mouse.click(5, 5);
  await expect(gift).toBeVisible();
  await gift.getByRole('button', { name: 'Cancel' }).click();
  await expect(gift).toHaveCount(0);

  await page.getByRole('row', { name: /Four weeks/ }).getByRole('button', { name: 'Freeze', exact: true }).click();
  const freeze = page.getByRole('dialog').filter({ has: page.getByTestId('freeze-modal') });
  await expectNewLook(freeze, ['Cancel', 'Freeze membership']);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a billing dialog fills the screen and its button band stays in view', async ({ page }) => {
    await page.goto(`/students/${s.student.id}`);
    await page.getByTestId('student-charges').getByRole('button', { name: '+ Recurring charge' }).click();
    const dialog = dialogNamed(page, /^Recurring charge for/);
    await expect(dialog).toBeVisible();
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(fits).toBe(true);
    const band = await dialog.locator('.ultm8-modal__actions').boundingBox();
    expect(band!.y + band!.height).toBeLessThanOrEqual(844 + 1);
    expect(band!.width).toBeGreaterThan(300);
  });
});
