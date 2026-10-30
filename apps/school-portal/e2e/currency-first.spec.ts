import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 414 item 6 — currency first. Until the School has set its currency
 * on the School page, no price can be saved: each price field is off, and a
 * warning says to set the currency first, with a link to the setting.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

test('the plan form warns to set the currency first, with its price off, and links to the setting', async ({ page }) => {
  await page.goto('/membership-plans/new');
  const notice = page.getByTestId('currency-first');
  await expect(notice).toContainText("Set your School's currency first.");
  await page.getByRole('button', { name: '2. Pricing & Access' }).click();
  await expect(page.getByLabel('Price')).toBeDisabled();

  await notice.getByRole('link', { name: 'Set the currency on the School page' }).click();
  await expect(page).toHaveURL(/\/school#edit-currency$/);
  await expect(page.locator('#edit-currency')).toBeFocused();
});

test('with the currency set, the plan form has no warning and the price can be typed', async ({ page }) => {
  await db.school.update({ where: { id: s.schoolId }, data: { defaultCurrency: 'GBP' } });
  await page.goto('/membership-plans/new');
  await page.getByRole('button', { name: '2. Pricing & Access' }).click();
  await expect(page.getByLabel('Price')).toBeEnabled();
  await expect(page.getByTestId('currency-first')).toHaveCount(0);
});

test('the belt editor warns to set the currency first, with the grade price off', async ({ page }) => {
  await db.school.update({ where: { id: s.schoolId }, data: { promotionFeeEnabled: true } });
  await page.goto(`/disciplines/${s.disciplineId}`);
  await page.getByRole('button', { name: 'Edit Blue' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Blue' });
  await expect(dialog.getByTestId('currency-first')).toBeVisible();
  await expect(dialog.getByLabel('Price for this grade')).toBeDisabled();
  await expect(dialog.getByRole('link', { name: 'Set the currency on the School page' })).toHaveAttribute('href', '/school#edit-currency');
});
