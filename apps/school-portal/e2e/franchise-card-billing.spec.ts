import { randomUUID, createHmac } from 'crypto';
import { expect, test } from '@playwright/test';
import { db, signIn } from './fixtures';

/**
 * Decision 407 (backlog 3.22) — the franchise fee paid by card, in the portal:
 * the Franchise Owner's "Connect Stripe" with its Connected / Action needed /
 * Not connected status, and the School Owner's "Add card" and fee charges on
 * the School page. Against the real API and Postgres; the answers that come
 * from Stripe itself (account status, the saved card, the hosted page's URL)
 * are stubbed with page.route, since there is no live Stripe here.
 */
function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signToken(payload: object): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET is not set');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify({ ...payload, iat: now, exp: now + 3600 }));
  const signature = base64url(createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${signature}`;
}

const userIds: string[] = [];
let franchiseId: string;
let schoolId: string;
let franchiseOwner: { id: string; email: string };
let schoolOwner: { id: string; email: string };

async function mkUser(label: string) {
  const user = await db.user.create({
    data: {
      id: randomUUID(),
      email: `franchise-card-e2e-${label}-${randomUUID()}@example.test`,
      phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
      firstName: label,
      surname: 'Card',
      passcodeHash: 'x',
      dateOfBirth: new Date('1990-01-01'),
      phoneVerifiedAt: new Date(),
    },
  });
  userIds.push(user.id);
  return user;
}

test.beforeEach(async () => {
  franchiseOwner = await mkUser('fowner');
  schoolOwner = await mkUser('sowner');
  const franchise = await db.franchise.create({ data: { id: randomUUID(), name: `Card Co ${randomUUID().slice(0, 8)}`, feeModel: 'FLAT', flatFeeAmount: 5000 } });
  franchiseId = franchise.id;
  await db.roleGrant.create({ data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: franchiseOwner.id, franchiseId } });
  const school = await db.school.create({ data: { id: randomUUID(), name: `Card School ${randomUUID().slice(0, 8)}`, franchiseId } });
  schoolId = school.id;
  await db.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: schoolOwner.id, schoolId } });
});

test.afterEach(async () => {
  await db.franchiseFeeCharge.deleteMany({ where: { franchiseId } });
  await db.notification.deleteMany({ where: { userId: { in: userIds } } });
  await db.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.school.deleteMany({ where: { id: schoolId } });
  await db.paymentAccount.deleteMany({ where: { franchiseId } });
  await db.franchise.deleteMany({ where: { id: franchiseId } });
  userIds.length = 0;
});

const franchiseToken = () =>
  signToken({ sub: franchiseOwner.id, email: franchiseOwner.email, grants: [{ role: 'FRANCHISE_OWNER', franchiseId, schoolId: null, branchId: null }] });
const schoolToken = () =>
  signToken({ sub: schoolOwner.id, email: schoolOwner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId, branchId: null }] });

test('the Franchise Owner sees Not connected and connects Stripe, choosing the country first', async ({ page }) => {
  let onboardCalled = false;
  await page.route('**/v1/payment-accounts/*/connect/onboard', (route) => {
    onboardCalled = true;
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ onboardingUrl: 'https://connect.stripe.test/onboarding' }) });
  });
  await page.route('https://connect.stripe.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Stripe onboarding</p>' }));
  await signIn(page, franchiseToken());
  await page.goto(`/franchises/${franchiseId}`);

  const card = page.getByTestId('stripe-connect');
  await expect(card.getByTestId('stripe-connect-status')).toHaveText('Not connected');
  await card.getByRole('button', { name: 'Connect Stripe' }).click();
  await page.getByLabel("Country of the business's bank account").selectOption('GB');
  await page.getByRole('button', { name: 'Continue to Stripe' }).click();

  await page.waitForURL('https://connect.stripe.test/onboarding');
  expect(onboardCalled).toBe(true);
  const account = await db.paymentAccount.findUniqueOrThrow({ where: { franchiseId } });
  expect(account).toMatchObject({ provider: 'STRIPE', country: 'GB' });
});

test('Action needed and Connected come from Stripe', async ({ page }) => {
  await db.paymentAccount.create({
    data: { id: randomUUID(), franchiseId, provider: 'STRIPE', accountTitle: 'Card Co', country: 'GB', stripeConnectedAccountId: `acct_e2e_${randomUUID()}` },
  });
  let status = 'ACTION_NEEDED';
  await page.route('**/v1/franchises/*/payment-account/connect-status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status }) }),
  );
  await signIn(page, franchiseToken());
  await page.goto(`/franchises/${franchiseId}`);
  const card = page.getByTestId('stripe-connect');
  await expect(card.getByTestId('stripe-connect-status')).toHaveText('Action needed');
  await expect(card.getByRole('button', { name: 'Continue Stripe setup' })).toBeVisible();

  status = 'CONNECTED';
  await page.reload();
  await expect(card.getByTestId('stripe-connect-status')).toHaveText('Connected');
  await expect(card.getByRole('button')).toHaveCount(0);
});

test("the School Owner can't add a card until the Franchise has connected Stripe", async ({ page }) => {
  await signIn(page, schoolToken());
  await page.goto('/school');
  await expect(page.getByTestId('franchise-fee-not-connected')).toBeVisible();
  await expect(page.getByTestId('franchise-fee').getByRole('button', { name: 'Add card' })).toHaveCount(0);
});

test("the School Owner adds a card on Stripe's page, then sees it and the School's fee charges", async ({ page }) => {
  const account = await db.paymentAccount.create({
    data: { id: randomUUID(), franchiseId, provider: 'STRIPE', accountTitle: 'Card Co', country: 'GB', stripeConnectedAccountId: `acct_e2e_${randomUUID()}` },
  });
  for (const [month, status] of [['2026-10', 'SUCCESSFUL'], ['2026-11', 'FAILED']] as const) {
    await db.franchiseFeeCharge.create({
      data: {
        id: randomUUID(),
        franchiseId,
        schoolId,
        franchisePaymentAccountId: account.id,
        billingPeriodStart: new Date(`${month}-01T00:00:00Z`),
        billingPeriodEnd: new Date(`${month}-28T00:00:00Z`),
        feeBasisSnapshot: 'FLAT',
        amount: 5000,
        currency: 'USD',
        status,
        stripeInvoiceId: `in_e2e_${randomUUID()}`,
      },
    });
  }
  let hasCard = false;
  await page.route('**/v1/schools/*/franchise-fee/card', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(hasCard ? { canAddCard: true, hasCard: true, brand: 'visa', last4: '4242' } : { canAddCard: true, hasCard: false }),
    }),
  );
  await page.route('**/v1/schools/*/franchise-fee/card/setup-session', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ checkoutUrl: 'https://checkout.stripe.test/cs_e2e' }) }),
  );
  await page.route('https://checkout.stripe.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Stripe Checkout</p>' }));

  await signIn(page, schoolToken());
  await page.goto('/school');
  const section = page.getByTestId('franchise-fee');
  await expect(section.getByTestId('franchise-fee-card')).toHaveText('No card added yet.');
  await expect(section.getByRole('row')).toHaveCount(3); // header + 2 charges
  await expect(section.getByText('Failed')).toBeVisible();
  await expect(section.getByText('Successful')).toBeVisible();

  await section.getByRole('button', { name: 'Add card' }).click();
  await page.waitForURL('https://checkout.stripe.test/cs_e2e');

  // Stripe sends the browser back to the School page.
  hasCard = true;
  await page.goto('/school?franchiseCard=added');
  await expect(page.getByText('Card saved. It can take a moment to show here.')).toBeVisible();
  await expect(section.getByTestId('franchise-fee-card')).toHaveText('Card: Visa ending 4242');
  await expect(section.getByRole('button', { name: 'Update card' })).toBeVisible();
});
