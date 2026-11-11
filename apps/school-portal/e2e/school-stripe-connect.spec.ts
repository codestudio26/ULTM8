import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn } from './fixtures';

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
  // Our own drop-down (DESIGN.md → "Drop-downs"), not the browser's.
  const picker = page.getByRole('combobox', { name: "Country of the business's bank account" });
  await expect(picker.locator('[data-shown="true"]')).toHaveText('United Kingdom');
  await picker.click();
  const countries = page.getByRole('listbox', { name: "Country of the business's bank account" });
  await expect(countries.getByRole('option', { name: 'United Kingdom' })).toHaveAttribute('aria-selected', 'true');
  await expect(countries.getByRole('option', { name: 'Brazil' })).toHaveCount(0);
  await picker.press('Escape');
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

test('Decision 442 item 3: Branch Staff connect Stripe only once an owner switches "Connect Stripe" on and has chosen Stripe (Decision 445 item 3)', async ({ page }) => {
  const s = await gbSchool();
  const north = await addBranch(s, 'North');
  const dee = await addPerson('Dee', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  let onboardCalled = false;
  await page.route('**/v1/payment-accounts/*/connect/onboard', (route) => {
    onboardCalled = true;
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ onboardingUrl: 'https://connect.stripe.test/onboarding' }) });
  });
  await page.route('https://connect.stripe.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Stripe onboarding</p>' }));

  // Off by default: nothing in their menu, and the School page stays the owners'.
  await signIn(page, dee.token);
  await page.goto('/timetable');
  await expect(page.getByRole('link', { name: 'Stripe account' })).toHaveCount(0);
  await page.goto('/school');
  await expect(page.getByTestId('school-owners-only')).toBeVisible();
  await expect(page.getByTestId('school-stripe-connect')).toHaveCount(0);

  // An owner switches it on in the Access window; it is in neither preset.
  await signIn(page, s.ownerToken);
  await page.goto('/staff');
  const row = page.locator('.ultm8-card').filter({ hasText: 'Your staff' }).getByRole('row').filter({ hasText: 'Dee Desk' });
  await row.getByRole('button', { name: 'Actions for Dee Desk' }).click();
  await page.getByRole('menuitem', { name: 'Access' }).click();
  const dialog = page.getByRole('dialog', { name: 'Access for Dee Desk' });
  await expect(dialog.getByText('Payments', { exact: true })).toBeVisible();
  const toggle = dialog.getByLabel('Connect Stripe', { exact: true });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Access saved for Dee Desk.')).toBeVisible();
  expect((await db.staffPermission.findFirstOrThrow({ where: { userId: dee.id, schoolId: s.schoolId } })).canConnectStripe).toBe(true);

  // Now the Stripe account is in their menu (Organisation, its only page there), with the Stripe card and nothing else of the School page.
  await signIn(page, dee.token);
  await page.goto('/timetable');
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: 'Organisation' }).click();
  await expect(page).toHaveURL(/\/school$/);
  await expect(page.getByTestId('school-settings')).toHaveCount(0);
  const card = page.getByTestId('school-stripe-connect');
  await expect(card.getByTestId('school-stripe-connect-status')).toHaveText('Not connected');
  // Decision 445 item 3: choosing how the School is paid (creating its
  // payment account) stays the owners', so there is nothing to press yet.
  await expect(card.getByTestId('school-stripe-connect-hint')).toHaveText('An owner must choose how the School is paid before Stripe can be connected.');
  await expect(card.getByRole('button', { name: 'Connect Stripe' })).toHaveCount(0);
  expect(await db.paymentAccount.findUnique({ where: { schoolId: s.schoolId } })).toBeNull();

  // Once an owner has chosen Stripe, they start Stripe's onboarding.
  await db.paymentAccount.create({ data: { id: randomUUID(), schoolId: s.schoolId, provider: 'STRIPE', accountTitle: 'Card', country: 'GB' } });
  await page.reload();
  await card.getByRole('button', { name: 'Connect Stripe' }).click();
  await page.waitForURL('https://connect.stripe.test/onboarding');
  expect(onboardCalled).toBe(true);
  expect(await db.paymentAccount.findUniqueOrThrow({ where: { schoolId: s.schoolId } })).toMatchObject({ provider: 'STRIPE', country: 'GB', stripeAccountReady: false });
});

test('Decision 442 item 2: until Stripe says the account is ready, the School is one without cards in the portal too', async ({ page }) => {
  const s = await gbSchool();
  await db.school.update({ where: { id: s.schoolId }, data: { defaultCurrency: 'GBP' } });
  const account = await db.paymentAccount.create({
    data: { id: randomUUID(), schoolId: s.schoolId, provider: 'STRIPE', accountTitle: 'Card', country: 'GB', stripeConnectedAccountId: `acct_e2e_${randomUUID()}` },
  });
  await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: 'Ten classes', price: 9000, currency: 'GBP', classesIncluded: 10 } });
  await signIn(page, s.ownerToken);

  // A plan's "switch to another plan" needs a saved card, so it isn't offered yet.
  async function policies() {
    await page.goto('/membership-plans');
    await page.getByRole('button', { name: 'Add plan' }).click();
    await page.getByLabel('Title').fill('Intro week');
    await page.getByLabel('Type').selectOption('WEEKLY_PASS');
    await page.getByRole('button', { name: '2. Pricing & Access' }).click();
    await page.getByLabel('Price').fill('20');
    await page.getByLabel('Expiry duration (days)').fill('7');
    await page.getByRole('button', { name: '3. Policies' }).click();
    await expect(page.getByLabel('Requires signed waiver/terms to purchase')).toBeVisible();
  }
  await policies();
  await expect(page.getByLabel('When it ends, switch to')).toHaveCount(0);

  // Stripe says the account is ready: the School takes cards.
  await db.paymentAccount.update({ where: { id: account.id }, data: { stripeAccountReady: true } });
  await policies();
  await expect(page.getByLabel('When it ends, switch to')).toBeVisible();
});
