import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The School page's Ad tracking card (Decision 318 item 10): the owner saves a
 * Meta Pixel ID and a Google Analytics ID, typed loosely (spaces, lower case)
 * and saved in the strict form; anything else is refused before saving. The
 * format rules are covered by apps/api/test/school-ad-tracking.e2e-spec.ts.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

test('the owner saves the School’s Meta Pixel and Google Analytics IDs', async ({ page }) => {
  await page.goto('/school');
  const card = page.locator('form#ad-tracking');
  await expect(card.getByRole('heading', { name: 'Ad tracking' })).toBeVisible();

  await card.getByLabel('Meta Pixel ID').fill('123<script>');
  await expect(card.getByText('A Meta Pixel ID is 10 to 20 digits, with nothing else.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Save' })).toBeDisabled();

  await card.getByLabel('Meta Pixel ID').fill(' 123456789012345 ');
  await card.getByLabel('Google Analytics measurement ID').fill('g-ab12cd34ef');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByText('Saved')).toBeVisible();
  await expect(card.getByLabel('Google Analytics measurement ID')).toHaveValue('G-AB12CD34EF');

  const school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(school).toMatchObject({ metaPixelId: '123456789012345', googleAnalyticsId: 'G-AB12CD34EF' });

  await card.getByLabel('Meta Pixel ID').fill('');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).metaPixelId).toBeNull();
});
