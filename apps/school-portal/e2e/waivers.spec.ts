import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Waivers page (Split-Pane Reader) against the real API: create, select in
 * the reader pane, and — v1.2 backend backlog — the real "Signatures" panel
 * (who HAS signed, with what status), replacing the visibly-inert
 * placeholder. Signing itself happens on the Student/Guardian side (the
 * mobile app), not this portal, so a signature is seeded directly rather
 * than driven through this page's own UI — same convention
 * membership-plans.spec.ts/student-grading.spec.ts already use for seeding
 * state this page's own UI can't produce.
 */
let s: GradingSchool;
const waiverIds: string[] = [];

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  await db.waiverSignature.deleteMany({ where: { waiverId: { in: waiverIds } } });
  await db.waiver.deleteMany({ where: { id: { in: waiverIds } } });
  waiverIds.length = 0;
});

test.afterAll(async () => {
  await cleanup();
});

test('the owner adds a Waiver and sees it in the reader pane', async ({ page }) => {
  await page.goto('/waivers');
  await page.getByRole('button', { name: 'Add waiver' }).click();
  await page.getByLabel('Title').fill('Liability Waiver');
  await page.getByLabel('Waiver text').fill('I acknowledge the risks of training.');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('heading', { level: 2, name: 'Liability Waiver' })).toBeVisible();
  // The short body text also appears verbatim in the sidebar row's own
  // preview — scope to the reader pane (the last match: sidebar first in
  // DOM order, reader pane second) to avoid a strict-mode ambiguity.
  await expect(page.getByText('I acknowledge the risks of training.').last()).toBeVisible();

  const created = await db.waiver.findFirstOrThrow({ where: { schoolId: s.schoolId, title: 'Liability Waiver' } });
  waiverIds.push(created.id);
});

test('the Signatures panel shows who HAS signed, with their status — real data, not the old inert placeholder', async ({ page }) => {
  const waiver = await db.waiver.create({ data: { id: randomUUID(), schoolId: s.schoolId, title: 'Signed Waiver', body: 'text' } });
  waiverIds.push(waiver.id);
  await db.waiverSignature.create({
    data: {
      id: randomUUID(),
      waiverId: waiver.id,
      studentId: s.student.id,
      signedById: s.student.id,
      schoolId: s.schoolId,
      signerFullName: 'Sam Lee',
      signatureText: 'Sam Lee',
      status: 'SIGNED',
    },
  });

  await page.goto('/waivers');
  await page.getByRole('button', { name: 'Signed Waiver' }).click();
  const panel = page.getByRole('heading', { level: 3, name: 'Signatures' }).locator('..');
  await expect(panel.getByText('Sam Lee')).toBeVisible();
  // exact: true — the new rollup line ("1 of 1 signed", v1.2 backend
  // backlog gap 2) also contains the substring "signed" case-insensitively,
  // which Playwright's default getByText match would otherwise also match.
  await expect(panel.getByText('SIGNED', { exact: true })).toBeVisible();
  // The old inert placeholder text must be gone.
  await expect(page.getByText('Not available yet')).toHaveCount(0);
});

test('shows "no one has signed yet" for a Waiver with no signatures', async ({ page }) => {
  const waiver = await db.waiver.create({ data: { id: randomUUID(), schoolId: s.schoolId, title: 'Unsigned Waiver', body: 'text' } });
  waiverIds.push(waiver.id);

  await page.goto('/waivers');
  await page.getByRole('button', { name: 'Unsigned Waiver' }).click();
  const panel = page.getByRole('heading', { level: 3, name: 'Signatures' }).locator('..');
  await expect(panel.getByText('No one has signed this Waiver yet.')).toBeVisible();
});

/**
 * v1.2 backend backlog ("Waivers page", gap 2) — the real display side of the
 * Unsigned-row-at-assignment-time gap: WaiverAssignmentService writes an
 * explicit Unsigned row at assignment time now, so this endpoint's response
 * (and this panel) carries "who hasn't signed yet" for real. Seeded directly
 * as WaiverAssignmentService itself would write it (status UNSIGNED, every
 * signer field null) rather than through the real assignment trigger
 * (createWaiver()/join()) — same "seed the state this page's own UI can't
 * produce" convention this file's own header comment already establishes for
 * a Signed row above.
 */
test('the Signatures panel shows an Unsigned entry distinctly, with the rollup count, alongside a Signed one', async ({ page }) => {
  const waiver = await db.waiver.create({ data: { id: randomUUID(), schoolId: s.schoolId, title: 'Mixed Status Waiver', body: 'text' } });
  waiverIds.push(waiver.id);
  await db.waiverSignature.create({
    data: {
      id: randomUUID(),
      waiverId: waiver.id,
      studentId: s.student.id,
      signedById: s.student.id,
      schoolId: s.schoolId,
      signerFullName: 'Sam Lee',
      signatureText: 'Sam Lee',
      status: 'SIGNED',
    },
  });
  // An assignment-time row for newStudent — no signer fields set at all,
  // exactly as WaiverAssignmentService.assignUnsignedRows() itself writes one.
  await db.waiverSignature.create({
    data: { id: randomUUID(), waiverId: waiver.id, studentId: s.newStudent.id, schoolId: s.schoolId, status: 'UNSIGNED' },
  });

  await page.goto('/waivers');
  await page.getByRole('button', { name: 'Mixed Status Waiver' }).click();
  const panel = page.getByRole('heading', { level: 3, name: 'Signatures' }).locator('..');

  // The rollup count — "1 of 2 signed".
  await expect(panel.getByText('1 of 2 signed')).toBeVisible();

  // The Signed entry — unchanged from the existing "who HAS signed" test.
  await expect(panel.getByText('Sam Lee')).toBeVisible();
  await expect(panel.getByText('SIGNED', { exact: true })).toBeVisible();

  // The Unsigned entry — falls back to the enrolled Student's own name
  // (studentName) since its own signerFullName is null, and is shown with
  // its own, distinct status badge.
  await expect(panel.getByText(s.newStudent.name)).toBeVisible();
  await expect(panel.getByText('UNSIGNED', { exact: true })).toBeVisible();
});
