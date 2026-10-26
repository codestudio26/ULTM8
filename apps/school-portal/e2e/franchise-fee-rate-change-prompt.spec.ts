import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { createHmac } from 'crypto';
import { cleanup, db, signIn } from './fixtures';

/**
 * Decision 99's own follow-up — FranchiseFormModal's "This rate change affects
 * already-billing Schools" prompt, required before saving a flatFeeAmount/
 * perHeadcountRate change once at least one member School already has a
 * standing franchise-fee Subscription. The real Stripe migration mechanics
 * themselves are covered by apps/api/test/franchise-fee-rate-migration.e2e-spec.ts
 * (real Stripe calls mocked there) — this only proves the UI prompt
 * shows/blocks/clears correctly against the real running API + Postgres (no
 * Stripe mock here: PATCH's own HTTP response returns before the background
 * migration job runs, same "enqueue, don't wait" shape every other
 * background-job-triggering endpoint in this app already has).
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

let ownerId: string;
let ownerToken: string;
let franchiseId: string;
let activityTag: string;
const schoolIds: string[] = [];

test.beforeEach(async () => {
  const owner = await db.user.create({
    data: {
      id: randomUUID(),
      email: `fee-rate-prompt-e2e-${randomUUID()}@example.test`,
      phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
      firstName: 'Fee',
      surname: 'Owner',
      passcodeHash: 'x',
      dateOfBirth: new Date('1990-01-01'),
      phoneVerifiedAt: new Date(),
    },
  });
  ownerId = owner.id;

  // A unique Activity tag, filtered on below — the Franchises list's default
  // id-ascending cursor page (Decision 22) only shows the first 20 rows, and
  // this dev database accumulates far more than that across this app's own
  // long-running test history; filtering is how franchises-filter.spec.ts's
  // own tests already find their fixture reliably too.
  activityTag = `RateChangePromptE2E-${randomUUID()}`;
  const franchise = await db.franchise.create({
    data: { id: randomUUID(), name: `Rate Prompt Co ${randomUUID()}`, feeModel: 'FLAT', flatFeeAmount: 5000, activities: [activityTag] },
  });
  franchiseId = franchise.id;
  await db.roleGrant.create({ data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: owner.id, franchiseId } });

  const school = await db.school.create({
    data: { id: randomUUID(), name: `Rate Prompt Fixture School ${randomUUID()}`, franchiseId, stripeFranchiseFeeSubscriptionId: `sub_fixture_${randomUUID()}` },
  });
  schoolIds.push(school.id);

  ownerToken = signToken({ sub: owner.id, email: owner.email, grants: [{ role: 'FRANCHISE_OWNER', franchiseId, schoolId: null, branchId: null }] });
});

test.afterEach(async () => {
  await db.franchiseFeeRateChange.deleteMany({ where: { franchiseId } });
  await db.school.deleteMany({ where: { id: { in: schoolIds } } });
  await db.roleGrant.deleteMany({ where: { franchiseId } });
  await db.franchise.delete({ where: { id: franchiseId } });
  await db.user.delete({ where: { id: ownerId } });
  schoolIds.length = 0;
});

test.afterAll(async () => {
  await cleanup();
});

test('Save is blocked until a strategy is chosen, and the rate change round-trips once one is picked', async ({ page }) => {
  await signIn(page, ownerToken);
  await page.goto('/franchises');
  await page.getByLabel('Activity').fill(activityTag);

  await page.getByRole('row', { name: /Rate Prompt Co/ }).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit franchise' })).toBeVisible();

  // Decision 336 (F5) — the form takes US dollars; the API stores cents.
  await page.getByLabel('Flat fee (USD per month)').fill('75.00');

  // The prompt itself depends on an async GET (useFranchiseBillingStatus) —
  // wait for it to actually render before clicking Save, so this proves the
  // CLIENT-side block (not merely the server's identical 400, already
  // covered by franchise-fee-rate-migration.e2e-spec.ts).
  await expect(page.getByText('This rate change affects already-billing Schools')).toBeVisible();

  // The prompt is required — Save doesn't close the modal without a choice.
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('already billing at the current rate')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Edit franchise' })).toBeVisible();

  await page.getByRole('button', { name: 'Apply from next billing cycle' }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('heading', { name: 'Edit franchise' })).toHaveCount(0);

  const updated = await db.franchise.findUniqueOrThrow({ where: { id: franchiseId } });
  expect(updated.flatFeeAmount).toBe(7500);
  const rateChange = await db.franchiseFeeRateChange.findFirstOrThrow({ where: { franchiseId } });
  expect(rateChange).toMatchObject({ strategy: 'MIGRATE_NEXT_CYCLE', oldFlatFeeAmount: 5000, newFlatFeeAmount: 7500 });
});

test('the prompt never appears for a no-op save or a profile-only edit', async ({ page }) => {
  await signIn(page, ownerToken);
  await page.goto('/franchises');
  await page.getByLabel('Activity').fill(activityTag);

  await page.getByRole('row', { name: /Rate Prompt Co/ }).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit franchise' })).toBeVisible();

  // Re-sending the same rate value is not a change.
  await page.getByLabel('Description').fill('Just a profile edit');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('heading', { name: 'Edit franchise' })).toHaveCount(0);
  const updated = await db.franchise.findUniqueOrThrow({ where: { id: franchiseId } });
  expect(updated.flatFeeAmount).toBe(5000);
  expect(updated.description).toBe('Just a profile edit');
});
