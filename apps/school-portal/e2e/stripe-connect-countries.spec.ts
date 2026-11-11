import { createHmac, randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn } from './fixtures';

/**
 * Decision 437 — the Connect Stripe button only shows where Stripe can onboard
 * the School or Franchise (ULTM8's UK platform: GB, the EU27, NO, CH, LI, GI).
 * A Brazilian Franchise sees no Connect button and an explanation instead,
 * and a UK one keeps it with a country picker limited to those countries. A
 * Brazilian School's setup checklist leaves the Stripe step out and says how
 * members pay; a UK School's keeps it. Against the real API and Postgres —
 * nothing here reaches Stripe.
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

const franchiseIds: string[] = [];
const userIds: string[] = [];

async function seedFranchise(addressCountry: string) {
  const franchise = await db.franchise.create({
    data: { id: randomUUID(), name: `Connect Co ${addressCountry} ${randomUUID().slice(0, 8)}`, feeModel: 'FLAT', flatFeeAmount: 5000, addressCountry },
  });
  franchiseIds.push(franchise.id);
  const owner = await db.user.create({
    data: {
      id: randomUUID(),
      email: `connect-countries-e2e-${randomUUID()}@example.test`,
      phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
      firstName: 'Franca',
      surname: 'Owner',
      passcodeHash: 'x',
      dateOfBirth: new Date('1990-01-01'),
      phoneVerifiedAt: new Date(),
    },
  });
  userIds.push(owner.id);
  await db.roleGrant.create({ data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: owner.id, franchiseId: franchise.id } });
  const token = signToken({ sub: owner.id, email: owner.email, grants: [{ role: 'FRANCHISE_OWNER', franchiseId: franchise.id, schoolId: null, branchId: null }] });
  return { franchiseId: franchise.id, token };
}

test.afterAll(async () => {
  await db.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.paymentAccount.deleteMany({ where: { franchiseId: { in: franchiseIds } } });
  await db.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
  await cleanup();
});

test('a Brazilian Franchise sees no Connect Stripe button, and why', async ({ page }) => {
  const { franchiseId, token } = await seedFranchise('BR');
  await signIn(page, token);
  await page.goto(`/franchises/${franchiseId}`);

  const card = page.getByTestId('stripe-connect');
  await expect(card.getByTestId('stripe-connect-status')).toHaveText('Not connected');
  await expect(card.getByTestId('stripe-connect-hint')).toHaveText(
    "Card payments in the app aren't available in this Franchise's country yet, so Stripe can't be connected. Payments are made by cash or bank transfer (Pix in Brazil) and confirmed by staff.",
  );
  await expect(card.getByRole('button')).toHaveCount(0);
  await expect(page.getByTestId('billing-notice')).toContainText("Card billing through Stripe isn't available in this Franchise's country yet.");
  await expect(page.getByTestId('billing-notice')).not.toContainText('Use Connect Stripe below');
});

test('a UK Franchise keeps the button, and the country picker offers only where Stripe can onboard', async ({ page }) => {
  const { franchiseId, token } = await seedFranchise('GB');
  await signIn(page, token);
  await page.goto(`/franchises/${franchiseId}`);

  const card = page.getByTestId('stripe-connect');
  await expect(card.getByTestId('stripe-connect-hint')).toHaveText('Connect a Stripe account so member Schools can pay their franchise fees by card.');
  await card.getByRole('button', { name: 'Connect Stripe' }).click();
  // Our own drop-down (DESIGN.md → "Drop-downs"), not the browser's.
  const picker = page.getByRole('combobox', { name: "Country of the business's bank account" });
  await expect(picker.locator('[data-shown="true"]')).toHaveText('United Kingdom');
  await picker.click();
  const countries = page.getByRole('listbox', { name: "Country of the business's bank account" });
  await expect(countries.getByRole('option', { name: 'United Kingdom' })).toHaveCount(1);
  await expect(countries.getByRole('option', { name: 'Ireland' })).toHaveCount(1);
  await expect(countries.getByRole('option', { name: 'Brazil' })).toHaveCount(0);
  await expect(countries.getByRole('option', { name: 'United States' })).toHaveCount(0);
  // "Select a country" plus the 32 countries.
  await expect(countries.getByRole('option')).toHaveCount(33);
});

test("a Brazilian School's setup checklist leaves out Connect Stripe and says how members pay; a UK School's keeps it", async ({ page, context }) => {
  const br = await seedGradingSchool();
  await db.school.update({ where: { id: br.schoolId }, data: { addressCountry: 'BR' } });
  await signIn(page, br.ownerToken);
  await page.goto('/dashboard');
  const checklist = page.getByRole('region', { name: 'Get your School ready' });
  // The fixture School has a style with belts only.
  await expect(checklist).toContainText('1 of 6 done');
  await expect(checklist.locator('[data-step="STRIPE"]')).toHaveCount(0);
  await expect(checklist.getByTestId('stripe-unavailable')).toHaveText(
    "Card payments in the app aren't available in your country yet, so members pay by cash or bank transfer (Pix in Brazil) and staff confirm it.",
  );

  const gb = await seedGradingSchool();
  await db.school.update({ where: { id: gb.schoolId }, data: { addressCountry: 'GB' } });
  const page2 = await context.newPage();
  await signIn(page2, gb.ownerToken);
  await page2.goto('/dashboard');
  const checklist2 = page2.getByRole('region', { name: 'Get your School ready' });
  await expect(checklist2).toContainText('1 of 7 done');
  await expect(checklist2.locator('[data-step="STRIPE"]')).toContainText('Connect Stripe');
  await expect(checklist2.getByTestId('stripe-unavailable')).toHaveCount(0);
});
