import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { expect, test, type Page } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn } from './fixtures';

/**
 * Sign-in and accounts review fixes: first sign-in with a temporary passcode
 * keeps a real session (A2), Log in links an unverified phone to Verify phone
 * (A6), Create your School has Log out (A5), and My profile can remove a
 * photo (A11). Then the answered questions (Decision 375): Change passcode on
 * My profile signs out other devices (Q1), and only someone 18 or over can
 * create a School (Q5).
 */
const PASSCODE = '123456';
const NEW_PASSCODE = '246810';
const userIds: string[] = [];

async function mkLoginUser(opts: { phone: string | null; phoneVerified: boolean; mustChangePasscode: boolean; dateOfBirth?: Date }) {
  const user = await db.user.create({
    data: {
      id: randomUUID(),
      email: `sign-in-review-${randomUUID()}@example.test`,
      phone: opts.phone,
      firstName: 'Tina',
      surname: 'Temp',
      passcodeHash: await bcrypt.hash(PASSCODE, 4),
      dateOfBirth: opts.dateOfBirth ?? new Date('1990-01-01'),
      phoneVerifiedAt: opts.phoneVerified ? new Date() : null,
      mustChangePasscode: opts.mustChangePasscode,
    },
  });
  userIds.push(user.id);
  return user;
}

async function fillLogin(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Passcode', { exact: true }).fill(PASSCODE);
  await page.getByRole('button', { name: 'Log in' }).click();
}

test.afterAll(async () => {
  await db.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await cleanup();
});

test('first sign-in with a temporary passcode keeps its own 30-day sign-in, not one left in the tab (A2)', async ({ page }) => {
  const user = await mkLoginUser({ phone: null, phoneVerified: false, mustChangePasscode: true });
  // Someone else's session was left in this tab earlier.
  await page.goto('/login');
  await page.evaluate(() => sessionStorage.setItem('ultm8.refreshToken', 'left-by-someone-else'));

  await fillLogin(page, user.email);
  await expect(page.getByRole('heading', { name: 'Choose your passcode' })).toBeVisible();
  await page.getByLabel('New passcode', { exact: true }).fill(NEW_PASSCODE);
  await page.getByLabel('Confirm new passcode').fill(NEW_PASSCODE);
  await page.getByRole('button', { name: 'Set passcode and continue' }).click();

  // No School yet, so home is Create your School.
  await expect(page.getByRole('heading', { name: 'Create your School' })).toBeVisible();
  const stored = await page.evaluate(() => sessionStorage.getItem('ultm8.refreshToken'));
  expect(stored).toBeTruthy();
  expect(stored).not.toBe('left-by-someone-else');
  const live = await db.refreshToken.findMany({ where: { userId: user.id, revokedAt: null } });
  expect(live).toHaveLength(1);

  // After the 15-minute token runs out, the session carries on as the same person.
  await page.evaluate(() => sessionStorage.setItem('ultm8.accessToken', 'not-a-real-token'));
  await page.goto('/profile');
  await expect(page.getByLabel('First name')).toHaveValue('Tina');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('ultm8.accessToken'))).not.toBe('not-a-real-token');
  const after = await db.refreshToken.findMany({ where: { userId: user.id, revokedAt: null } });
  expect(after).toHaveLength(1);
  expect(after[0]!.id).not.toBe(live[0]!.id);
});

test('Create your School has a Log out button (A5)', async ({ page }) => {
  const user = await mkLoginUser({ phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`, phoneVerified: true, mustChangePasscode: false });
  await fillLogin(page, user.email);
  await expect(page.getByRole('heading', { name: 'Create your School' })).toBeVisible({ timeout: 5000 });

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(() => sessionStorage.getItem('ultm8.refreshToken'))).toBeNull();
});

test('an unverified phone gets plain wording and a link to Verify phone (A6)', async ({ page }) => {
  const user = await mkLoginUser({ phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`, phoneVerified: false, mustChangePasscode: false });
  await fillLogin(page, user.email);

  await expect(page.getByText("Your phone number isn't verified yet. Verify it to finish creating your account.")).toBeVisible();
  await expect(page.getByText('POST /auth')).toHaveCount(0);
  await page.getByRole('link', { name: 'Verify your phone' }).click();
  await expect(page).toHaveURL(/\/verify-otp/);
});

test('My profile: Remove photo clears the saved photo (A11)', async ({ page }) => {
  const s = await seedGradingSchool();
  await db.user.update({ where: { id: s.ownerId }, data: { profilePhotoUrl: 'https://photos.example.test/olive.png' } });
  await signIn(page, s.ownerToken);
  await page.goto('/profile');

  await page.getByRole('button', { name: 'Remove photo' }).click();
  await expect(page.getByRole('button', { name: 'Upload photo' })).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  const owner = await db.user.findUniqueOrThrow({ where: { id: s.ownerId } });
  expect(owner.profilePhotoUrl).toBeNull();
});

test('My profile: Change passcode keeps this tab signed in and signs out the other one (Q1)', async ({ page, context }) => {
  const user = await mkLoginUser({ phone: null, phoneVerified: false, mustChangePasscode: false });
  // Two tabs keep separate sign-ins (sessionStorage), like two devices.
  const here = page;
  const there = await context.newPage();
  await fillLogin(there, user.email);
  await expect(there.getByRole('heading', { name: 'Create your School' })).toBeVisible();
  await fillLogin(here, user.email);
  await expect(here.getByRole('heading', { name: 'Create your School' })).toBeVisible();

  await here.goto('/profile');
  await here.getByLabel('Current passcode').fill('000000');
  await here.getByLabel('New passcode', { exact: true }).fill(NEW_PASSCODE);
  await here.getByLabel('Confirm new passcode').fill(NEW_PASSCODE);
  await here.getByRole('button', { name: 'Change passcode' }).click();
  await expect(here.getByText('Your current passcode is not right.')).toBeVisible();

  await here.getByLabel('Current passcode').fill(PASSCODE);
  await here.getByRole('button', { name: 'Change passcode' }).click();
  await expect(here.getByText('Passcode changed. You were signed out on your other devices.')).toBeVisible();
  await expect(here.getByLabel('Current passcode')).toHaveValue('');

  // This tab carries on: a reload still shows the profile.
  await here.reload();
  await expect(here.getByLabel('First name')).toHaveValue('Tina');

  // The other tab is signed out on its next request.
  await there.goto('/profile');
  await expect(there).toHaveURL(/\/login/);

  const fresh = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(await bcrypt.compare(NEW_PASSCODE, fresh.passcodeHash)).toBe(true);
  await there.close();
});

test('Create your School is refused for someone under 18 (Q5)', async ({ page }) => {
  const seventeen = new Date(Date.UTC(new Date().getUTCFullYear() - 17, 0, 1));
  const user = await mkLoginUser({ phone: null, phoneVerified: false, mustChangePasscode: false, dateOfBirth: seventeen });
  await fillLogin(page, user.email);
  await expect(page.getByRole('heading', { name: 'Create your School' })).toBeVisible();

  await page.getByLabel('School name').fill('Too Young Dojo');
  await page.getByRole('button', { name: 'Create School' }).click();
  await expect(page.getByText('You must be 18 or over to create a School.')).toBeVisible();
  expect(await db.school.count({ where: { name: 'Too Young Dojo' } })).toBe(0);
});
