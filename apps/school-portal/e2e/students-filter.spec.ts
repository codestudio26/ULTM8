import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * v1.2 backend backlog, "Students page" — the Active/Inactive/All filter.
 * findAllStudentsForSchool previously hard-coded `revokedAt: null`, so a revoked
 * ("inactive") enrollment had no way to ever appear on this page at all.
 */
let s: GradingSchool;
let revokedStudentId: string;
let revokedGrantId: string;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // already has one active Student: Sam Lee

  const revoked = await db.user.create({
    data: {
      id: randomUUID(),
      email: `students-filter-e2e-${randomUUID()}@example.test`,
      phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
      firstName: 'Riley',
      surname: 'Revoked',
      passcodeHash: 'x',
      dateOfBirth: new Date('2000-01-01'),
      phoneVerifiedAt: new Date(),
      // Set so this spec also covers the roster's avatar column's photo-set
      // case (StudentsPage/Avatar) — Sam Lee, from seedGradingSchool, has none
      // set, covering the initials-fallback case in the same run below.
      profilePhotoUrl: 'https://example.test/riley-revoked-photo.jpg',
    },
  });
  revokedStudentId = revoked.id;
  const grant = await db.roleGrant.create({
    data: { id: randomUUID(), role: 'STUDENT', userId: revoked.id, schoolId: s.schoolId, revokedAt: new Date() },
  });
  revokedGrantId = grant.id;
});

test.afterEach(async () => {
  await db.roleGrant.deleteMany({ where: { id: revokedGrantId } });
  await db.user.deleteMany({ where: { id: revokedStudentId } });
});

test.afterAll(async () => {
  await cleanup();
});

test('Active (default) hides a revoked enrollment; Inactive and All surface it', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/students');

  // Default view is Active — matches the pre-existing behavior exactly.
  await expect(page.getByLabel('Status')).toHaveValue('ACTIVE');
  await expect(page.getByRole('cell', { name: 'Sam Lee' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Riley Revoked' })).toHaveCount(0);

  // Avatar column (profilePhotoUrl, StudentSummaryResponseDto) — Sam Lee has no
  // photo set, so its cell falls back to an initials monogram, not an <img>.
  const samRow = page.getByRole('row', { name: /Sam Lee/ });
  await expect(samRow.getByText('SL', { exact: true })).toBeVisible();
  await expect(samRow.locator('img')).toHaveCount(0);

  await page.getByLabel('Status').selectOption('INACTIVE');
  await expect(page.getByRole('cell', { name: 'Riley Revoked' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Sam Lee' })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Riley Revoked/ }).getByText('Inactive', { exact: true })).toBeVisible();

  // Riley DOES have a photo set — renders a real <img>, not initials. Attached,
  // not visible: example.test never loads, and WebKit hides a broken image.
  const rileyRow = page.getByRole('row', { name: /Riley Revoked/ });
  await expect(rileyRow.locator('img[src="https://example.test/riley-revoked-photo.jpg"]')).toBeAttached();
  await expect(rileyRow.getByText('RR', { exact: true })).toHaveCount(0);

  await page.getByLabel('Status').selectOption('ALL');
  await expect(page.getByRole('cell', { name: 'Riley Revoked' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Sam Lee' })).toBeVisible();
});
