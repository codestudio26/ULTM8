import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 232 — leave/switch-Franchise, on top of Decision 98's existing
 * one-way-only join-franchise endpoint. Covers the new Franchise affiliation
 * card on SchoolPage: join (no prior UI existed for this at all), leave, then
 * switch (join a different Franchise after leaving).
 */
let s: GradingSchool;
const franchiseIds: string[] = [];

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  await db.roleGrant.deleteMany({ where: { franchiseId: { in: franchiseIds } } });
  await db.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
  franchiseIds.length = 0;
});

test.afterAll(async () => {
  await cleanup();
});

test('School Owner joins, leaves, then switches Franchise from the School profile page', async ({ page }) => {
  const franchiseA = await db.franchise.create({ data: { id: randomUUID(), name: 'Affiliation Test Franchise A' } });
  franchiseIds.push(franchiseA.id);

  await page.goto('/school');
  await expect(page.getByRole('heading', { name: 'Franchise affiliation' })).toBeVisible();
  await expect(page.getByText('This School is independent')).toBeVisible();

  await page.getByLabel('Franchise ID').fill(franchiseA.id);
  await page.getByRole('button', { name: 'Join Franchise' }).click();

  await expect(page.getByText(franchiseA.id)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Leave Franchise' })).toBeVisible();

  const afterJoin = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(afterJoin.franchiseId).toBe(franchiseA.id);

  // Decision 337 (F6) — Leave asks first; Cancel keeps the School in.
  await page.getByRole('button', { name: 'Leave Franchise' }).click();
  const confirm = page.getByRole('dialog', { name: 'Leave this Franchise?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  expect((await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).franchiseId).toBe(franchiseA.id);

  await page.getByRole('button', { name: 'Leave Franchise' }).click();
  await page.getByRole('dialog', { name: 'Leave this Franchise?' }).getByRole('button', { name: 'Leave Franchise' }).click();
  await expect(page.getByText('This School is independent')).toBeVisible();

  const afterLeave = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(afterLeave.franchiseId).toBeNull();

  // Switch — join a second, different Franchise now that leaving cleared the
  // one-way guard (Decision 98's own 409 no longer applies).
  const franchiseB = await db.franchise.create({ data: { id: randomUUID(), name: 'Affiliation Test Franchise B' } });
  franchiseIds.push(franchiseB.id);

  await page.getByLabel('Franchise ID').fill(franchiseB.id);
  await page.getByRole('button', { name: 'Join Franchise' }).click();
  await expect(page.getByText(franchiseB.id)).toBeVisible();

  const afterSwitch = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(afterSwitch.franchiseId).toBe(franchiseB.id);
});

test("Decision 346 — the Franchise's name and logo show only when both owners allow it", async ({ page }) => {
  const name = `Branding Test Franchise ${randomUUID().slice(0, 8)}`;
  const franchise = await db.franchise.create({ data: { id: randomUUID(), name } });
  franchiseIds.push(franchise.id);
  await db.school.update({ where: { id: s.schoolId }, data: { franchiseId: franchise.id } });

  await page.goto('/school');
  const toggle = page.getByRole('switch', { name: "Show the Franchise's name and logo" });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('franchise-branding-not-allowed')).toBeVisible();

  // The School Owner turns it on first: kept, but nothing shows yet.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).showFranchiseBranding).toBe(true);
  await expect(page.getByTestId('franchise-branding-preview')).toHaveCount(0);
  await expect(page.getByTestId('footer-franchise-branding')).toHaveCount(0);

  // Then the Franchise Owner allows it: the name shows, here and in the footer.
  await db.franchise.update({ where: { id: franchise.id }, data: { shareBrandingWithMembers: true } });
  await page.reload();
  await expect(page.getByTestId('franchise-branding-preview')).toHaveText(`Shown as: Part of ${name}`);
  await expect(page.getByTestId('footer-franchise-branding')).toHaveText(`Part of ${name}`);

  // The School Owner turns it off again.
  await page.getByRole('switch', { name: "Show the Franchise's name and logo" }).click();
  await expect(page.getByTestId('footer-franchise-branding')).toHaveCount(0);
  await expect.poll(async () => (await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).showFranchiseBranding).toBe(false);
});
