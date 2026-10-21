import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { expect, test } from '@playwright/test';
import { cleanup, db } from './fixtures';

/**
 * School-portal refresh-token logic — before this, a session silently died exactly
 * 15 minutes after login/last refresh with no recovery (apps/api mints a 15-minute
 * access token and a 30-day refresh token on login, but nothing in this app ever
 * stored or used the refresh token). This drives a REAL login through the UI form
 * (not the usual `signIn()` shortcut, which only ever seeds an access token) so the
 * refresh token this test exercises is the real one `login()` now persists, then
 * corrupts the access token directly to simulate expiry and proves the app recovers
 * transparently — no bounce to /login, no visible error — via the same
 * `onUnauthorized` -> `refreshSession()` path apps/student's own identical fix
 * already uses.
 */
let ownerId: string;
let schoolId: string;
const PASSCODE = '123456';

test.beforeEach(async () => {
  const school = await db.school.create({ data: { id: randomUUID(), name: `Refresh Token Fixture School ${randomUUID()}` } });
  schoolId = school.id;
  const passcodeHash = await bcrypt.hash(PASSCODE, 12); // same BCRYPT_ROUNDS AuthService uses
  const owner = await db.user.create({
    data: {
      id: randomUUID(),
      email: `refresh-token-e2e-${randomUUID()}@example.test`,
      phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
      firstName: 'Refresh',
      surname: 'Owner',
      passcodeHash,
      dateOfBirth: new Date('1990-01-01'),
      phoneVerifiedAt: new Date(),
    },
  });
  ownerId = owner.id;
  await db.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId } });
});

test.afterEach(async () => {
  await db.roleGrant.deleteMany({ where: { schoolId } });
  await db.branch.deleteMany({ where: { schoolId } });
  await db.refreshToken.deleteMany({ where: { userId: ownerId } });
  await db.user.delete({ where: { id: ownerId } });
  await db.school.delete({ where: { id: schoolId } });
});

test.afterAll(async () => {
  await cleanup();
});

async function realLogin(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Passcode', { exact: true }).fill(PASSCODE);
  await page.getByRole('button', { name: 'Log in' }).click();
  // SuccessPanel (AuthSuccessCard) auto-advances after 2s (its own default
  // autoAdvanceMs) — no "Continue" button text to click, just wait it out.
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 5000 });
}

test('a real login stores both an access token and a refresh token', async ({ page }) => {
  const owner = await db.user.findUniqueOrThrow({ where: { id: ownerId } });
  await realLogin(page, owner.email);

  const tokens = await page.evaluate(() => ({
    accessToken: sessionStorage.getItem('ultm8.accessToken'),
    refreshToken: sessionStorage.getItem('ultm8.refreshToken'),
  }));
  expect(tokens.accessToken).toBeTruthy();
  expect(tokens.refreshToken).toBeTruthy();
  expect(tokens.refreshToken).not.toBe(tokens.accessToken);

  const stored = await db.refreshToken.findMany({ where: { userId: ownerId } });
  expect(stored).toHaveLength(1);
  expect(stored[0]!.revokedAt).toBeNull();
});

test('an expired/invalid access token is silently refreshed mid-session — no bounce to /login', async ({ page }) => {
  const owner = await db.user.findUniqueOrThrow({ where: { id: ownerId } });
  await realLogin(page, owner.email);

  const before = await page.evaluate(() => sessionStorage.getItem('ultm8.accessToken'));

  // Simulate the ordinary mid-session case (apps/api's 15-minute TTL elapsing) by
  // corrupting the access token in place — RequireAuth only checks truthiness
  // client-side, so this still renders the Dashboard, which then makes a real,
  // now-401ing API call.
  await page.evaluate(() => sessionStorage.setItem('ultm8.accessToken', 'not-a-real-token'));
  await page.reload();

  // Recovers transparently: still on the Dashboard, never redirected to /login.
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);

  const after = await page.evaluate(() => sessionStorage.getItem('ultm8.accessToken'));
  expect(after).toBeTruthy();
  expect(after).not.toBe('not-a-real-token');
  expect(after).not.toBe(before);

  // The refresh token was rotated (AuthService.refresh()'s own guarantee) — exactly
  // one still-live row for this user, not the original one still sitting unrevoked.
  const stored = await db.refreshToken.findMany({ where: { userId: ownerId } });
  expect(stored.filter((t) => t.revokedAt === null)).toHaveLength(1);
});

test('a save made after the access token expired goes through once the session is refreshed', async ({ page }) => {
  const owner = await db.user.findUniqueOrThrow({ where: { id: ownerId } });
  await realLogin(page, owner.email);
  await page.goto('/school');
  await expect(page.getByLabel('School name')).not.toHaveValue('');

  // Expires while the page is open, so the save itself is the request that 401s
  // and has to be retried — before the fix that retry threw "Illegal invocation"
  // and the page showed "Something went wrong".
  await page.evaluate(() => sessionStorage.setItem('ultm8.accessToken', 'not-a-real-token'));
  await page.getByLabel('School name').fill('Renamed After Refresh');
  await page.getByRole('button', { name: 'Save changes' }).first().click();

  await expect(page.getByText('Saved.')).toBeVisible();
  const school = await db.school.findUniqueOrThrow({ where: { id: schoolId } });
  expect(school.name).toBe('Renamed After Refresh');
});

test('archiving a Branch after the access token expired goes through once the session is refreshed', async ({ page }) => {
  const branch = await db.branch.create({ data: { id: randomUUID(), schoolId, name: 'Refresh Archive Branch', address: '1 Test St' } });
  const owner = await db.user.findUniqueOrThrow({ where: { id: ownerId } });
  await realLogin(page, owner.email);
  await page.goto('/branches');
  await expect(page.getByText('Refresh Archive Branch')).toBeVisible();

  // Same expiry as above, on a POST with no body — before the fix this showed
  // "Could not archive this Branch."
  await page.evaluate(() => sessionStorage.setItem('ultm8.accessToken', 'not-a-real-token'));
  await page.getByRole('button', { name: 'Actions for Refresh Archive Branch' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();

  await expect(page.getByText('Could not archive this Branch.')).toHaveCount(0);
  await expect.poll(async () => (await db.branch.findUniqueOrThrow({ where: { id: branch.id } })).archivedAt).not.toBeNull();
});

test('logging out revokes the refresh token server-side and clears both tokens locally', async ({ page }) => {
  const owner = await db.user.findUniqueOrThrow({ where: { id: ownerId } });
  await realLogin(page, owner.email);

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);

  const tokens = await page.evaluate(() => ({
    accessToken: sessionStorage.getItem('ultm8.accessToken'),
    refreshToken: sessionStorage.getItem('ultm8.refreshToken'),
  }));
  expect(tokens.accessToken).toBeNull();
  expect(tokens.refreshToken).toBeNull();

  const stored = await db.refreshToken.findMany({ where: { userId: ownerId } });
  expect(stored).toHaveLength(1);
  expect(stored[0]!.revokedAt).not.toBeNull();
});
