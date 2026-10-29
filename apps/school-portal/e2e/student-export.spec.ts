import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Export the student list (backlog 3.9, Decision 399): the owner downloads a
 * CSV with translated headers; a Branch Staff member gets the Export button
 * only once the owner turns on "Export the student list" in their Access.
 *
 * Seed: Sam Lee (BJJ White 1) and Nia Park, both enrolled, both born 2000-01-01.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterAll(async () => {
  await db.studentExportLog.deleteMany({});
  await cleanup();
});

type Page = import('@playwright/test').Page;

async function exportCsv(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export students' });
  await expect(dialog.getByText('Children are included, with their Guardian. Every export is logged.')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download CSV' }).click()]);
  return readFileSync((await download.path())!, 'utf8').replace(/^﻿/, '');
}

test('the owner downloads the student list as a CSV, and the export is logged', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/students');
  const csv = await exportCsv(page);
  const [header, ...lines] = csv.trim().split('\r\n');
  expect(header).toBe('First name,Surname,Email,Phone,Date of birth,Age,Status,Joined,Visitor,Memberships,Billing,Belts,Last visit,Guardian,Guardian email');
  const sam = lines.find((l) => l.startsWith('Sam,Lee,'))!;
  expect(sam).toContain(',2000-01-01,');
  expect(sam).toContain(',Active,');
  expect(sam).toContain(',BJJ: White 1,');
  expect(lines.some((l) => l.startsWith('Nia,Park,'))).toBe(true);
  const log = await db.studentExportLog.findFirstOrThrow({ where: { schoolId: s.schoolId } });
  expect(log).toMatchObject({ exportedById: s.ownerId, filter: 'ACTIVE', rowCount: 2 });
});

test('Branch Staff see Export only after the owner turns it on in their Access', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const bea = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, branchId: north.id } });

  await signIn(page, bea.token);
  await page.goto('/students');
  await expect(page.getByRole('link', { name: s.student.name })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0);

  await signIn(page, s.ownerToken);
  await page.goto('/staff');
  const row = page.locator('.ultm8-card').filter({ hasText: 'Your staff' }).getByRole('row').filter({ hasText: 'Bea Desk' });
  await row.getByRole('button', { name: 'Actions for Bea Desk' }).click();
  await page.getByRole('menuitem', { name: 'Access' }).click();
  const dialog = page.getByRole('dialog', { name: 'Access for Bea Desk' });
  await expect(dialog.getByLabel('Export the student list')).not.toBeChecked();
  await dialog.getByLabel('Export the student list').check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Access saved for Bea Desk.')).toBeVisible();
  expect((await db.staffPermission.findFirstOrThrow({ where: { userId: bea.id } })).canExportStudents).toBe(true);

  await signIn(page, bea.token);
  await page.goto('/students');
  const csv = await exportCsv(page);
  // Only the student her branch covers, with the Home branch column.
  const [header, ...lines] = csv.trim().split('\r\n');
  expect(header).toContain(',Joined,Home branch,Visitor,');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('Sam,Lee,');
  expect(lines[0]).toContain(',North,');
});
