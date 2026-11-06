import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { expect, test } from '@playwright/test';
import { cleanup, db } from './fixtures';

/**
 * Legal go-live fixes (Decision 440): the legal pages are open to everyone,
 * sign-up and Create your School each have an "I agree" tick, and the version
 * accepted is saved.
 */
const PASSCODE = '123456';
const userIds: string[] = [];
const schoolIds: string[] = [];

test.afterAll(async () => {
  await db.legalDocument.update({ where: { slug: 'cookie-notice' }, data: { content: null, version: 'unpublished' } });
  await db.roleGrant.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await db.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await db.school.deleteMany({ where: { id: { in: schoolIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await cleanup();
});

test('a legal page says it is being prepared until its text is loaded, then shows it', async ({ page }) => {
  await page.goto('/legal/terms-and-conditions');
  await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
  await expect(page.getByText('This page is being prepared.', { exact: false })).toBeVisible();

  await db.legalDocument.update({ where: { slug: 'cookie-notice' }, data: { content: 'We use only the storage the app needs.', version: 'cookies-2.0' } });
  await page.goto('/legal/cookie-notice');
  await expect(page.getByRole('heading', { name: 'Cookie and Storage Notice' })).toBeVisible();
  await expect(page.getByTestId('legal-content')).toHaveText('We use only the storage the app needs.');
  await expect(page.getByText('Version cookies-2.0')).toBeVisible();

  await page.goto('/legal/not-a-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('sign-up has a required Terms and Privacy tick that links to both pages', async ({ page }) => {
  await page.goto('/register');
  const tick = page.getByRole('checkbox', { name: /I agree to the Terms of Service/ });
  await expect(tick).not.toBeChecked();
  await expect(tick).toHaveAttribute('required', '');
  await expect(page.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/legal/terms-and-conditions');
  await expect(page.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/legal/privacy-statement');
});

test('Create your School needs the Agreement tick, and saves the version accepted', async ({ page }) => {
  const user = await db.user.create({
    data: {
      id: randomUUID(),
      email: `legal-pages-${randomUUID()}@example.test`,
      phone: null,
      firstName: 'Lena',
      surname: 'Legal',
      passcodeHash: await bcrypt.hash(PASSCODE, 4),
      dateOfBirth: new Date('1990-01-01'),
    },
  });
  userIds.push(user.id);
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Passcode', { exact: true }).fill(PASSCODE);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Create your School' })).toBeVisible();

  const name = `Legal Dojo ${randomUUID().slice(0, 8)}`;
  await page.getByLabel('School name').fill(name);
  await page.getByRole('button', { name: 'Create School' }).click();
  // The browser stops the form while the required tick is empty.
  expect(await db.school.count({ where: { name } })).toBe(0);

  await page.getByRole('checkbox', { name: /I accept the School and Franchise Agreement/ }).check();
  await page.getByRole('button', { name: 'Create School' }).click();
  await expect(page).toHaveURL(/\/school$/);
  const school = await db.school.findFirstOrThrow({ where: { name } });
  schoolIds.push(school.id);
  const accepted = await db.legalAcceptance.findMany({ where: { userId: user.id, schoolId: school.id } });
  expect(accepted.map((a) => a.documentSlug)).toEqual(['school-agreement']);
});
