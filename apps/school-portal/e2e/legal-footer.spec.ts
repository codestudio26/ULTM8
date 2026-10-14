import { expect, test } from '@playwright/test';
import { cleanup, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 256 — standard B2B footer on the main content column of every
 * shell page. Confirms it actually renders (copyright + the three
 * disabled-for-now links), not just that `AppShell` compiles with the new
 * prop — a static-content feature like this has no other real way to
 * regress than "it silently stopped rendering."
 */
let s: GradingSchool;

test.afterEach(async () => {
  await cleanup();
});

test('the Dashboard shows the standard footer — copyright plus disabled Terms/Privacy/Support', async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');

  const footer = page.locator('.ultm8-shell__legal-footer');
  await expect(footer).toBeVisible();
  await expect(footer).toContainText(`© ${new Date().getFullYear()} ULTM8`);
  await expect(footer).toContainText('Terms of Service (coming soon)');
  await expect(footer).toContainText('Privacy Policy (coming soon)');
  await expect(footer).toContainText('Support (coming soon)');
  // Not a real link yet — disabled links render as <span>, not <a>.
  await expect(footer.locator('a')).toHaveCount(0);
});
