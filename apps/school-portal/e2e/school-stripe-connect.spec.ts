import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn } from './fixtures';

/**
 * Decision 441 item 6 — the School owner connects Stripe from the School page
 * (instead of ULTM8 support), and the setup checklist ticks "Connect Stripe"
 * only once Stripe has confirmed the account is ready. Against the real API
 * and Postgres; the answers that come from Stripe itself (the onboarding link,
 * the account's status) are stubbed with page.route, since there is no live
 * Stripe here.
 */
const schoolIds: string[] = [];

test.afterAll(async () => {
  await db.paymentAccount.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await cleanup();
});

async function gbSchool(addressCountry = 'GB') {
  const s = await seedGradingSchool();
  schoolIds.push(s.schoolId);
  await db.school.update({ where: { id: s.schoolId }, data: { addressCountry } });
  return s;
}

test('the owner connects Stripe from the School page, choosing the country, and comes back to the card', async ({ page }) => {
  const s = await gbSchool();
  let onboardCalled = false;
  await page.route('**/v1/payment-accounts/*/connect/onboard', (route) => {
    onboardCalled = true;
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ onboardingUrl: 'https://connect.stripe.test/onboarding' }) });
  });
  await page.route('https://connect.stripe.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Stripe onboarding</p>' }));
  await signIn(page, s.ownerToken);

  // The checklist links to the card.
  await page.goto('/dashboard');
  const checklist = page.getByRole('region', { name: 'Get your School ready' });
  await expect(checklist.locator('[data-step="STRIPE"]')).toHaveAttribute('data-done', 'false');
  await checklist.getByRole('link', { name: 'Connect Stripe' }).click();
  await expect(page).toHaveURL(/\/school#stripe-connect$/);

  const card = page.getByTestId('school-stripe-connect');
  await expect(card.getByTestId('school-stripe-connect-status')).toHaveText('Not connected');
  await expect(card.getByTestId('school-stripe-connect-hint')).toHaveText(
    "Connect your School's Stripe account so members can pay by card in the app. Stripe asks for your business and bank details.",
  );
  await card.getByRole('button', { name: 'Connect Stripe' }).click();
  const picker = page.getByLabel("Country of the business's bank account");
  await expect(picker).toHaveValue('GB');
  await expect(picker.locator('option[value="BR"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue to Stripe' }).click();

  await page.waitForURL('https://connect.stripe.test/onboarding');
  expect(onboardCalled).toBe(true);
  const account = await db.paymentAccount.findUniqueOrThrow({ where: { schoolId: s.schoolId } });
  expect(account).toMatchObject({ provider: 'STRIPE', country: 'GB', stripeAccountReady: false });

  // Stripe's return link brings the owner back to the card.
  await page.goto('/payments/connect/return');
  await expect(page).toHaveURL(/\/school#stripe-connect$/);
  await expect(page.getByTestId('school-stripe-connect-status')).toHaveText('Not connected');
});

test('Action needed, then Connected; the checklist ticks only once Stripe says the account is ready', async ({ page }) => {
  const s = await gbSchool();
  const account = await db.paymentAccount.create({
    data: { id: randomUUID(), schoolId: s.schoolId, provider: 'STRIPE', accountTitle: 'Card', country: 'GB', stripeConnectedAccountId: `acct_e2e_${randomUUID()}` },
  });
  let status = 'ACTION_NEEDED';
  await page.route('**/v1/schools/*/payment-account/connect-status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status, connectAvailable: true, connectCountries: ['GB'] }) }),
  );
  await signIn(page, s.ownerToken);

  // Onboarding started but not finished: not ticked.
  await page.goto('/dashboard');
  const checklist = page.getByRole('region', { name: 'Get your School ready' });
  await expect(checklist.locator('[data-step="STRIPE"]')).toHaveAttribute('data-done', 'false');

  await page.goto('/school');
  const card = page.getByTestId('school-stripe-connect');
  await expect(card.getByTestId('school-stripe-connect-status')).toHaveText('Action needed');
  await expect(card.getByTestId('school-stripe-connect-hint')).toHaveText('Stripe needs more details before your account is ready. Continue the setup on Stripe.');
  await expect(card.getByRole('button', { name: 'Continue Stripe setup' })).toBeVisible();

  status = 'CONNECTED';
  await page.reload();
  await expect(card.getByTestId('school-stripe-connect-status')).toHaveText('Connected');
  await expect(card.getByRole('button')).toHaveCount(0);

  // Stripe confirmed the account (the webhook or the read above saves it).
  await db.paymentAccount.update({ where: { id: account.id }, data: { stripeAccountReady: true } });
  await page.goto('/dashboard');
  await expect(checklist.locator('[data-step="STRIPE"]')).toHaveAttribute('data-done', 'true');
});

test('a Brazilian School sees no Connect Stripe button, and why', async ({ page }) => {
  const s = await gbSchool('BR');
  await signIn(page, s.ownerToken);
  await page.goto('/school');
  const card = page.getByTestId('school-stripe-connect');
  await expect(card.getByTestId('school-stripe-connect-status')).toHaveText('Not connected');
  await expect(card.getByTestId('school-stripe-connect-hint')).toHaveText(
    "Card payments in the app aren't available in your country yet, so members pay by cash or bank transfer (Pix in Brazil) and staff confirm it.",
  );
  await expect(card.getByRole('button')).toHaveCount(0);
});

test('a School whose payment account is for cash or bank transfer sees no Connect Stripe button', async ({ page }) => {
  const s = await gbSchool();
  await db.paymentAccount.create({ data: { id: randomUUID(), schoolId: s.schoolId, provider: 'BANK_TRANSFER', accountTitle: 'Bank', country: 'GB' } });
  await signIn(page, s.ownerToken);
  await page.goto('/school');
  const card = page.getByTestId('school-stripe-connect');
  await expect(card.getByTestId('school-stripe-connect-hint')).toHaveText("This School's payment account is for cash or bank transfer, so Stripe can't be connected here.");
  await expect(card.getByRole('button')).toHaveCount(0);
});
