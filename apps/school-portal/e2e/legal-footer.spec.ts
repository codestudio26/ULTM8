import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 256 — standard B2B footer, shared across all three apps
 * (platform-admin/apps/student keep this exact shape). Decision 257 replaces
 * it on the School Portal specifically with a richer, per-School footer
 * (`SchoolFooter.tsx`) — these specs cover that replacement: the footer
 * renders with real School data (name, Programs from Disciplines, Company
 * links), hides every per-School field that isn't set, and the Footer
 * settings form on SchoolPage actually round-trips through the API into
 * what the footer shows.
 */
let s: GradingSchool;

test.afterEach(async () => {
  await cleanup();
});

test('the Dashboard shows the School Portal\'s own richer footer — School name, Programs from this School\'s Disciplines, Company links, Terms/Privacy still coming-soon, no Contact/social (none set)', async ({ page }) => {
  s = await seedGradingSchool();
  const school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');

  const footer = page.locator('.ultm8-shell__legal-footer');
  await expect(footer).toBeVisible();
  await expect(footer).toContainText(school.name);
  await expect(footer).toContainText('Programs');
  await expect(footer).toContainText('BJJ');
  await expect(footer.getByRole('link', { name: 'Instructors' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'Locations' })).toBeVisible();
  await expect(footer).toContainText('Terms of Service (coming soon)');
  await expect(footer).toContainText('Privacy Policy (coming soon)');
  // Not a backlog item to resolve here — just visible, disabled, decorative.
  await expect(page.getByPlaceholder('Enter your zip code')).toBeDisabled();
  // Nothing set for this School yet — Contact/About-us/social icons all hidden entirely.
  await expect(footer).not.toContainText('@');
  await expect(footer.locator('.ultm8-school-footer__social')).toHaveCount(0);
});

test('Footer settings on the School page save, and the Dashboard footer picks them up — Contact + one social icon appear, the rest stay hidden', async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
  await page.goto('/school');

  await page.getByLabel('About us').fill('Family-owned since 2010.');
  await page.getByLabel('Contact email').fill('front-desk@example.com');
  await page.getByLabel('Instagram URL').fill('https://instagram.com/example');
  await page.getByRole('button', { name: 'Save changes' }).last().click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.goto('/dashboard');
  const footer = page.locator('.ultm8-shell__legal-footer');
  await expect(footer).toContainText('Family-owned since 2010.');
  await expect(footer.getByRole('link', { name: 'front-desk@example.com' })).toHaveAttribute('href', 'mailto:front-desk@example.com');
  await expect(footer.locator('.ultm8-school-footer__social-icon')).toHaveCount(1);
  await expect(footer.getByRole('link', { name: 'Instagram' })).toHaveAttribute('href', 'https://instagram.com/example');
});

test('the footer is a full-width band below the ENTIRE shell (sidebar included), not confined to the main content column', async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');

  const footerBox = await page.locator('.ultm8-shell__legal-footer').boundingBox();
  const sidebarBox = await page.locator('.ultm8-shell__sidebar').boundingBox();
  const pageWidth = await page.evaluate(() => document.documentElement.clientWidth);
  if (!footerBox || !sidebarBox) throw new Error('footer or sidebar not found');
  expect(footerBox.x).toBeLessThanOrEqual(sidebarBox.x + 1);
  expect(footerBox.x + footerBox.width).toBeGreaterThanOrEqual(pageWidth - 1);
});
