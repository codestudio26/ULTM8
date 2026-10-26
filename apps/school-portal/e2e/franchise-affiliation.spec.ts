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
