import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 406 — the owner's card surcharge setting, against the real API and
 * Postgres. Hidden while the School's country isn't on the Platform Admin
 * list; where it is, saving it on needs the legal confirmation. A card
 * payment's surcharge shows as its own line on the Transactions page.
 */
const COUNTRY = 'PY';
let s: GradingSchool;
const schoolIds: string[] = [];

test.beforeEach(async () => {
  s = await seedGradingSchool();
  schoolIds.push(s.schoolId);
  await db.school.update({ where: { id: s.schoolId }, data: { addressCountry: COUNTRY } });
});

test.afterAll(async () => {
  await db.cardSurchargeCountry.deleteMany({ where: { countryCode: COUNTRY } });
  const where = { schoolId: { in: schoolIds } };
  await db.transaction.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
  await db.paymentAccount.deleteMany({ where });
  await cleanup();
});

test('hidden where the country is not allowed', async ({ page }) => {
  await db.cardSurchargeCountry.deleteMany({ where: { countryCode: COUNTRY } });
  await signIn(page, s.ownerToken);
  await page.goto('/school');
  await expect(page.getByRole('heading', { name: 'Bookings and check-in' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Card surcharge' })).toHaveCount(0);
});

test('where allowed, the owner switches it on only after confirming it is legal', async ({ page }) => {
  await db.cardSurchargeCountry.upsert({ where: { countryCode: COUNTRY }, create: { countryCode: COUNTRY }, update: {} });
  await signIn(page, s.ownerToken);
  await page.goto('/school');
  const card = page.locator('form#card-surcharge');
  await expect(card.getByRole('heading', { name: 'Card surcharge' })).toBeVisible();
  await card.getByLabel('Add a card surcharge').check();
  await card.getByLabel('Surcharge (%)').fill('3.5');
  await expect(card.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await card.getByLabel('I confirm surcharges are legal where my School operates').check();
  await card.getByRole('button', { name: 'Save changes' }).click();
  await expect(card.getByText('Enter a surcharge above 0% and up to 3%, with at most two decimals.')).toBeVisible();
  await card.getByLabel('Surcharge (%)').fill('2.5');
  await card.getByRole('button', { name: 'Save changes' }).click();
  await expect(card.getByText('Saved.')).toBeVisible();
  const school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(school).toMatchObject({ cardSurchargeEnabled: true, cardSurchargeBps: 250 });
  expect(school.cardSurchargeConfirmedAt).not.toBeNull();
});

test('a card payment shows its surcharge as its own line on Transactions', async ({ page }) => {
  const account = await db.paymentAccount.create({
    data: { id: randomUUID(), schoolId: s.schoolId, provider: 'STRIPE', accountTitle: 'Card', country: COUNTRY, stripeConnectedAccountId: `acct_${randomUUID().slice(0, 8)}` },
  });
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: 'Surcharged Pack', price: 2000, classesIncluded: 5, currency: 'USD' } });
  await db.transaction.create({
    data: {
      id: randomUUID(), schoolId: s.schoolId, studentId: s.ownerId, paymentAccountId: account.id, membershipPlanId: plan.id,
      amount: 2000, surchargeAmount: 50, currency: 'USD', status: 'SUCCESSFUL', paymentMethod: 'STRIPE', stripePaymentIntentId: `pi_${randomUUID()}`,
    },
  });
  await signIn(page, s.ownerToken);
  await page.goto('/transactions');
  await expect(page.getByText('+ 0.50 USD card surcharge')).toBeVisible();
});
