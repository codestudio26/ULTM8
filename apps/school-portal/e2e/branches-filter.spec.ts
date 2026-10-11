import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * v1.2 backend backlog, "Branches page" — the City filter, now a real server-side
 * filter (GET /schools/:schoolId/branches?city=) instead of filtering an
 * already-fetched list client-side. Branch has no dedicated city column, so this
 * matches against the free-text address field (BranchesQueryDto's own comment).
 */
let s: GradingSchool;
const branchIds: string[] = [];

test.beforeEach(async () => {
  s = await seedGradingSchool();
  const toronto = await db.branch.create({
    data: { id: randomUUID(), schoolId: s.schoolId, name: 'Downtown Toronto', address: '123 Main St, Toronto, ON' },
  });
  const vaughan = await db.branch.create({
    data: { id: randomUUID(), schoolId: s.schoolId, name: 'Vaughan Mills', address: '456 King St, Vaughan, ON' },
  });
  branchIds.push(toronto.id, vaughan.id);
});

test.afterEach(async () => {
  await db.branch.deleteMany({ where: { id: { in: branchIds } } });
  branchIds.length = 0;
});

test.afterAll(async () => {
  await cleanup();
});

test('typing a city filters the Branches list to only matching addresses', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/branches');

  await expect(page.getByRole('cell', { name: 'Downtown Toronto' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Vaughan Mills' })).toBeVisible();

  await page.getByLabel('City').fill('Toronto');

  await expect(page.getByRole('cell', { name: 'Downtown Toronto' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Vaughan Mills' })).toHaveCount(0);

  // Clearing the filter brings both back.
  await page.getByLabel('City').fill('');
  await expect(page.getByRole('cell', { name: 'Vaughan Mills' })).toBeVisible();
});
