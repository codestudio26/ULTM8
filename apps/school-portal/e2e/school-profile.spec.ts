import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The School profile form is long, so its Save button sits far below the
 * banner that reports the result. The banner must come into view on its own.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterAll(async () => {
  await cleanup();
});

test('saving the School profile brings the "Saved." message into view', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/school');
  await page.getByLabel('School name').fill('Profile Spec School');
  await page.getByRole('button', { name: 'Save changes' }).first().click();

  await expect(page.getByText('Saved.')).toBeInViewport();
  const school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(school.name).toBe('Profile Spec School');
});

test('a failed save brings the error into view', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.route('**/v1/schools/*', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST', message: 'Test conflict.' } }) })
      : route.fallback(),
  );
  await page.goto('/school');
  await page.getByRole('button', { name: 'Save changes' }).first().click();

  await expect(page.getByRole('alert').filter({ hasText: 'Test conflict.' })).toBeInViewport();
});

test('a footer link that is not a web address is pointed out under its own field, and nothing is saved', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/school');
  await page.getByLabel('Facebook URL').fill('my school page');
  await page.getByLabel('Instagram URL').fill('instagram.com/myschool');
  const footerSave = page.locator('form').filter({ has: page.getByLabel('Facebook URL') }).getByRole('button', { name: 'Save changes' });
  await footerSave.click();

  const facebook = page.getByLabel('Facebook URL');
  await expect(facebook).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Enter a full web address, like https://facebook.com/yourschool.')).toHaveCount(1);
  // The other link was fine: https:// is added and it has no error.
  await expect(page.getByLabel('Instagram URL')).toHaveValue('https://instagram.com/myschool');
  await expect(page.getByLabel('Instagram URL')).not.toHaveAttribute('aria-invalid', 'true');
  let school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(school.footerInstagramUrl).toBeNull();

  // Fixing it clears the error and saves both.
  await facebook.fill('facebook.com/myschool');
  await expect(facebook).not.toHaveAttribute('aria-invalid', 'true');
  await footerSave.click();
  await expect(page.getByText('Saved.')).toBeVisible();
  school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(school.footerFacebookUrl).toBe('https://facebook.com/myschool');
  expect(school.footerInstagramUrl).toBe('https://instagram.com/myschool');
});
