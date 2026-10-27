import { randomUUID, createHmac } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, signIn } from './fixtures';

/**
 * Decision 337 — the Franchises section review's portal fixes: fees typed in
 * dollars (F5), a fee required for the chosen model (F7), the fee model locked
 * while Schools are billed (F1), Closed labels (F8, F9), the Franchise ID with
 * a Copy button (F13), the "billing can't start yet" notice, charges from a
 * School that has left (F14), and the Franchise Owner's switch for showing
 * its name and logo on member Schools (Decision 350), and Decision 352: join
 * requests, removing a member School, and closing the Franchise. Leave's confirmation (F6) is in
 * franchise-affiliation.spec.ts. Against the real API and Postgres.
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
// The Franchises list shows 20 rows a page and this database holds many more,
// so each test filters by its own Activity tag (as franchises-filter.spec.ts does).
let activityTag: string;
const extraFranchiseIds: string[] = [];
const schoolIds: string[] = [];
const userIds: string[] = [];

async function mkUser(label: string) {
  const user = await db.user.create({
    data: {
      id: randomUUID(),
      email: `franchise-review-e2e-${label}-${randomUUID()}@example.test`,
      phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
      firstName: label,
      surname: 'Review',
      passcodeHash: 'x',
      dateOfBirth: new Date('1990-01-01'),
      phoneVerifiedAt: new Date(),
    },
  });
  userIds.push(user.id);
  return user;
}

/** A member School with its own Owner, like every real School. */
async function seedMemberSchool(name: string, data: Record<string, unknown> = {}) {
  const school = await db.school.create({ data: { id: randomUUID(), name, franchiseId, ...data } });
  schoolIds.push(school.id);
  const owner = await mkUser('sowner');
  await db.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
  return school;
}

test.beforeEach(async ({ page }) => {
  const owner = await mkUser('fowner');
  ownerId = owner.id;
  activityTag = `FranchiseReviewE2E-${randomUUID()}`;
  const franchise = await db.franchise.create({
    data: { id: randomUUID(), name: `Review Co ${randomUUID().slice(0, 8)}`, feeModel: 'FLAT', flatFeeAmount: 5000, activities: [activityTag] },
  });
  franchiseId = franchise.id;
  await db.roleGrant.create({ data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: owner.id, franchiseId } });
  ownerToken = signToken({ sub: owner.id, email: owner.email, grants: [{ role: 'FRANCHISE_OWNER', franchiseId, schoolId: null, branchId: null }] });
  await signIn(page, ownerToken);
});

test.afterEach(async () => {
  const ids = [franchiseId, ...extraFranchiseIds];
  await db.franchiseFeeCharge.deleteMany({ where: { franchiseId: { in: ids } } });
  await db.franchiseFeeRateChange.deleteMany({ where: { franchiseId: { in: ids } } });
  await db.roleGrant.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { franchiseId: { in: ids } }, { schoolId: { in: schoolIds } }] } });
  await db.school.deleteMany({ where: { id: { in: schoolIds } } });
  await db.paymentAccount.deleteMany({ where: { franchiseId: { in: ids } } });
  await db.franchise.deleteMany({ where: { id: { in: ids } } });
  // Decision 364 — accepting, declining and removing send notices; let the worker finish first.
  await new Promise((r) => setTimeout(r, 1500));
  await db.notification.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  extraFranchiseIds.length = 0;
  schoolIds.length = 0;
  userIds.length = 0;
});

test.afterAll(async () => {
  await cleanup();
});

test('F5 — a new Franchise\'s flat fee is typed in dollars and saved in cents', async ({ page }) => {
  const name = `Dollar Co ${randomUUID().slice(0, 8)}`;
  await page.goto('/franchises');
  await page.getByRole('button', { name: 'Add franchise' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Franchise name').fill(name);
  await dialog.getByLabel('Flat fee (USD per month)').fill('50.25');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  const created = await db.franchise.findFirstOrThrow({ where: { name } });
  extraFranchiseIds.push(created.id);
  expect(created.feeModel).toBe('FLAT');
  expect(created.flatFeeAmount).toBe(5025);
});

test('F7 — a Franchise can\'t be saved without a fee for its fee model', async ({ page }) => {
  const name = `No Fee Co ${randomUUID().slice(0, 8)}`;
  await page.goto('/franchises');
  await page.getByRole('button', { name: 'Add franchise' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Franchise name').fill(name);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Enter a flat fee for the Flat fee model.')).toBeVisible();

  await dialog.getByLabel('Fee model').selectOption('PER_HEADCOUNT');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Enter a per-headcount rate for the Per-headcount fee model.')).toBeVisible();
  expect(await db.franchise.count({ where: { name } })).toBe(0);
});

test('F5 — editing shows the stored fee in dollars', async ({ page }) => {
  await page.goto('/franchises');
  await page.getByLabel('Activity').fill(activityTag);
  await page.getByRole('row', { name: /Review Co/ }).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('dialog').getByLabel('Flat fee (USD per month)')).toHaveValue('50.00');
});

test('F1 — the fee model can\'t be changed while a School is being billed', async ({ page }) => {
  await seedMemberSchool('Billing Member School', { stripeFranchiseFeeSubscriptionId: `sub_fixture_${randomUUID()}`, franchiseFeeSubscriptionStatus: 'ACTIVE' });
  await page.goto('/franchises');
  await page.getByLabel('Activity').fill(activityTag);
  await page.getByRole('row', { name: /Review Co/ }).getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Fee model')).toBeDisabled();
  await expect(dialog.getByText("Can't change while Schools are being billed.")).toBeVisible();
});

test('F11 — the Activity filter ignores capitals', async ({ page }) => {
  await page.goto('/franchises');
  await page.getByLabel('Activity').fill(activityTag.toLowerCase());
  await expect(page.getByRole('row', { name: /Review Co/ })).toBeVisible();
});

test('F8 — a closed Franchise is labelled Closed and can\'t be edited', async ({ page }) => {
  await db.franchise.update({ where: { id: franchiseId }, data: { archivedAt: new Date() } });
  await page.goto('/franchises');
  await page.getByLabel('Activity').fill(activityTag);
  const row = page.getByRole('row', { name: /Review Co/ });
  await expect(row.getByText('Closed')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Edit' })).toHaveCount(0);
});

test('F13 — the detail page shows the Franchise ID with a Copy button', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only in Playwright');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/franchises/${franchiseId}`);
  await expect(page.getByText(franchiseId)).toBeVisible();
  await page.getByRole('button', { name: 'Copy ID' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(franchiseId);
});

test('billing notice — says why billing can\'t start, and goes once the fee and Stripe are set', async ({ page }) => {
  await db.franchise.update({ where: { id: franchiseId }, data: { flatFeeAmount: null } });
  await page.goto(`/franchises/${franchiseId}`);
  const notice = page.getByTestId('billing-notice');
  await expect(notice).toContainText("Billing can't start yet");
  await expect(notice).toContainText('Set a flat fee');
  await expect(notice).toContainText('no connected Stripe account');

  await db.franchise.update({ where: { id: franchiseId }, data: { flatFeeAmount: 5000 } });
  await db.paymentAccount.create({
    data: { id: randomUUID(), franchiseId, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: `acct_fixture_${randomUUID()}` },
  });
  await page.reload();
  await expect(page.getByText(franchiseId)).toBeVisible();
  await expect(page.getByTestId('billing-notice')).toHaveCount(0);
});

test('F9 and F14 — a closed member School is labelled, and a charge from a School that left says "Former member School"', async ({ page }) => {
  await seedMemberSchool('Closed Member School', { archivedAt: new Date() });
  const account = await db.paymentAccount.create({
    data: { id: randomUUID(), franchiseId, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: `acct_fixture_${randomUUID()}` },
  });
  const formerSchool = await db.school.create({ data: { id: randomUUID(), name: 'Left Earlier School' } });
  schoolIds.push(formerSchool.id);
  await db.franchiseFeeCharge.create({
    data: {
      id: randomUUID(),
      franchiseId,
      schoolId: formerSchool.id,
      franchisePaymentAccountId: account.id,
      billingPeriodStart: new Date('2026-09-01T00:00:00Z'),
      billingPeriodEnd: new Date('2026-10-01T00:00:00Z'),
      feeBasisSnapshot: 'FLAT',
      amount: 5000,
      currency: 'USD',
      status: 'SUCCESSFUL',
    },
  });

  await page.goto(`/franchises/${franchiseId}`);
  await expect(page.getByRole('row', { name: /Closed Member School/ }).getByText('Closed')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Former member School' })).toBeVisible();
});

test('Decision 350 — the Franchise Owner lets member Schools show the name and logo', async ({ page }) => {
  await page.goto('/franchises');
  await page.getByLabel('Activity').fill(activityTag);
  await page.getByRole('row', { name: /Review Co/ }).getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog');
  const toggle = dialog.getByRole('switch', { name: "Let member Schools show this Franchise's name and logo" });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await db.franchise.findUniqueOrThrow({ where: { id: franchiseId } })).shareBrandingWithMembers).toBe(true);
});

/** bcrypt of PASSCODE, so the Franchise Owner can pass the passcode check. */
const PASSCODE = '246810';
const PASSCODE_HASH = '$2a$04$QgvRMStkWKUF3MhKA6PCqOyLa9KyeaFbUN70R/Q3Hdw0o0DANsmIy';

test('Decision 352 — the Franchise Owner accepts and declines Schools asking to join', async ({ page }) => {
  const asking = await seedMemberSchool('Asking Dojo', { franchiseId: null });
  const declined = await seedMemberSchool('Declined Dojo', { franchiseId: null });
  const requestedById = (await db.roleGrant.findFirstOrThrow({ where: { schoolId: asking.id } })).userId;
  for (const school of [asking, declined]) {
    await db.franchiseJoinRequest.create({ data: { id: randomUUID(), franchiseId, schoolId: school.id, schoolName: school.name, requestedById } });
  }

  await page.goto(`/franchises/${franchiseId}`);
  const card = page.getByTestId('join-requests');
  await expect(card.getByRole('heading', { name: 'Schools asking to join' })).toBeVisible();
  await card.getByRole('button', { name: 'Accept Asking Dojo' }).click();
  await expect(page.getByRole('row', { name: /Asking Dojo/ })).toBeVisible();
  await card.getByRole('button', { name: 'Decline Declined Dojo' }).click();
  await expect(card).toContainText('No Schools are asking to join right now.');

  expect((await db.school.findUniqueOrThrow({ where: { id: asking.id } })).franchiseId).toBe(franchiseId);
  expect((await db.school.findUniqueOrThrow({ where: { id: declined.id } })).franchiseId).toBeNull();
  await expect(page.getByRole('row', { name: /Declined Dojo/ })).toHaveCount(0);
});

test('Decision 352 — the Franchise Owner removes a member School after confirming', async ({ page }) => {
  const member = await seedMemberSchool('Removable Dojo');
  await page.goto(`/franchises/${franchiseId}`);
  await page.getByRole('button', { name: 'Remove Removable Dojo' }).click();
  const confirm = page.getByRole('dialog', { name: 'Remove Removable Dojo?' });
  await expect(confirm).toContainText('the same as if it left itself');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  expect((await db.school.findUniqueOrThrow({ where: { id: member.id } })).franchiseId).toBe(franchiseId);

  await page.getByRole('button', { name: 'Remove Removable Dojo' }).click();
  await page.getByRole('dialog', { name: 'Remove Removable Dojo?' }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('row', { name: /Removable Dojo/ })).toHaveCount(0);
  expect((await db.school.findUniqueOrThrow({ where: { id: member.id } })).franchiseId).toBeNull();
});

test('Decision 352 — the Franchise Owner closes the Franchise with its name and their passcode', async ({ page }) => {
  await db.user.update({ where: { id: ownerId }, data: { passcodeHash: PASSCODE_HASH } });
  const name = (await db.franchise.findUniqueOrThrow({ where: { id: franchiseId } })).name;
  await page.goto(`/franchises/${franchiseId}`);
  await page.getByRole('button', { name: 'Close Franchise' }).click();
  const dialog = page.getByRole('dialog', { name: 'Close this Franchise?' });
  const submit = dialog.getByRole('button', { name: 'Close Franchise' });

  await dialog.getByLabel(`Type "${name}" to confirm`).fill('not the name');
  await expect(submit).toBeDisabled();
  await dialog.getByLabel(`Type "${name}" to confirm`).fill(name);
  await dialog.getByLabel('Your 6-digit passcode').fill('111111');
  await submit.click();
  await expect(dialog).toContainText('Incorrect passcode.');
  expect((await db.franchise.findUniqueOrThrow({ where: { id: franchiseId } })).archivedAt).toBeNull();

  await dialog.getByLabel('Your 6-digit passcode').fill(PASSCODE);
  await submit.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Closed', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close Franchise' })).toHaveCount(0);
  const after = await db.franchise.findUniqueOrThrow({ where: { id: franchiseId } });
  expect(after.archivedAt).not.toBeNull();
  expect(after.purgeAt).not.toBeNull();
});
