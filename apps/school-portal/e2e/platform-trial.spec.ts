import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Free trial of ULTM8 (backlog 3.14; Decision 318 item 5): the owner sees the
 * days left, and once it has ended without a subscription, that the portal is
 * read-only until they subscribe. ULTM8 HQ sets it in Platform Admin.
 */
let s: GradingSchool;
const DAY = 86_400_000;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

const trialEnds = (ms: number, status: 'ACTIVE' | null = null) =>
  db.school.update({ where: { id: s.schoolId }, data: { platformTrialStartedAt: new Date(Date.now() - DAY), platformTrialEndsAt: new Date(Date.now() + ms), platformSubscriptionStatus: status } });

test('no trial, no banner', async ({ page }) => {
  await page.goto('/disciplines');
  await expect(page.getByRole('heading').first()).toBeVisible();
  await expect(page.getByText(/Free trial of ULTM8/)).toHaveCount(0);
});

test('a running trial shows the days left', async ({ page }) => {
  await trialEnds(5 * DAY - 60_000);
  await page.goto('/disciplines');
  await expect(page.getByRole('status').filter({ hasText: 'Free trial of ULTM8: 5 days left.' })).toBeVisible();
});

test('an ended trial says the portal is read-only; a subscription hides it', async ({ page }) => {
  await trialEnds(-DAY);
  await page.goto('/disciplines');
  await expect(page.getByText('Your free trial of ULTM8 has ended. The portal is read-only until you subscribe', { exact: false })).toBeVisible();
  await trialEnds(-DAY, 'ACTIVE');
  await page.reload();
  await expect(page.getByRole('heading').first()).toBeVisible();
  await expect(page.getByText(/free trial of ULTM8/i)).toHaveCount(0);
});
