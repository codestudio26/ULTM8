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
