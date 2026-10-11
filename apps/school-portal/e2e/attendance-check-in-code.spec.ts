import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 235 — no-camera check-in fallback: the Class-QR display screen
 * (ClassQrCodePage, Phase 52/Decision 107) now also shows the rotating
 * 6-digit code as text alongside the QR, so a Student with no working
 * camera can type it on their own device instead of scanning
 * (`POST /attendance/code`, covered end-to-end in attendance.e2e-spec.ts —
 * this spec only covers that the Staff-facing display screen actually
 * renders the code).
 */
let s: GradingSchool;
let classId: string;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  const cls = await db.class.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      title: 'Open Mat',
      activities: ['BJJ'],
      startDate: new Date(),
      endDate: new Date(Date.now() + 3600_000),
    },
  });
  classId = cls.id;
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  await db.class.deleteMany({ where: { id: classId } });
});

test.afterAll(async () => {
  await cleanup();
});

test('the QR display screen also shows a 6-digit fallback code as text', async ({ page }) => {
  await page.goto(`/classes/${classId}/qr-code`);

  await expect(page.getByText('No camera? Students can type this code instead:')).toBeVisible();
  const codeLocator = page.getByText(/^\d{6}$/);
  await expect(codeLocator).toBeVisible();
  const code = await codeLocator.textContent();
  expect(code).toMatch(/^\d{6}$/);
});
