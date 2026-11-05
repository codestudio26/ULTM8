import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The payroll report (Decision 320 item 4), the owner's side: setting a
 * coach's hourly and per-class rates, then reading the report over custom
 * dates and downloading it. The counting rules are covered by
 * apps/api/test/payroll.e2e-spec.ts.
 */
let s: GradingSchool;
let coachId: string;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await db.school.update({ where: { id: s.schoolId }, data: { defaultCurrency: 'GBP' } });
  const coach = await db.user.create({
    data: {
      id: randomUUID(),
      email: `portal-e2e-${randomUUID()}@example.test`,
      phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
      firstName: 'Cora',
      surname: 'Coach',
      passcodeHash: 'x',
      phoneVerifiedAt: new Date(),
    },
  });
  coachId = coach.id;
  await db.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: coachId, schoolId: s.schoolId } });
  // Two classes taught in March 2026: 60 and 90 minutes; one cancelled.
  const cls = (start: string, minutes: number, cancelled = false) =>
    db.class.create({
      data: {
        id: randomUUID(),
        schoolId: s.schoolId,
        instructorId: coachId,
        title: 'Fundamentals',
        startDate: new Date(start),
        endDate: new Date(Date.parse(start) + minutes * 60_000),
        cancelledAt: cancelled ? new Date(start) : null,
      },
    });
  await cls('2026-03-02T18:00:00Z', 60);
  await cls('2026-03-09T18:00:00Z', 90);
  await cls('2026-03-16T18:00:00Z', 60, true);
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  await db.staffPayRate.deleteMany({ where: { schoolId: s.schoolId } });
  await db.class.deleteMany({ where: { schoolId: s.schoolId } });
  await db.roleGrant.deleteMany({ where: { userId: coachId } });
  await db.user.delete({ where: { id: coachId } });
});

test.afterAll(async () => {
  await cleanup();
});

test('the owner sets a coach’s rates and reads what they earned', async ({ page }) => {
  await page.goto('/payroll');
  await expect(page.getByRole('heading', { name: 'Payroll' })).toBeVisible();
  // Nobody has a rate yet.
  await expect(page.getByText('Nobody has a rate yet')).toBeVisible();

  await page.getByRole('tab', { name: 'Rates' }).click();
  const rates = page.getByTestId('payroll-rates');
  await rates.getByLabel('Hourly rate for Cora Coach').fill('20');
  await rates.getByLabel('Per-class rate for Cora Coach').fill('5.50');
  await rates.getByRole('row', { name: /Cora Coach/ }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Rates saved for Cora Coach.')).toBeVisible();

  await page.getByRole('tab', { name: 'Report' }).click();
  const report = page.getByTestId('payroll-report');
  await report.getByLabel('Dates').selectOption('CUSTOM');
  await report.getByLabel('From').fill('2026-03-01');
  await report.getByLabel('To').fill('2026-03-31');
  // 2.5 hours × 20.00 + 2 classes × 5.50 = 61.00
  const row = report.getByRole('row', { name: /Cora Coach/ });
  await expect(row).toContainText('2');
  await expect(row).toContainText('2.5');
  await expect(row).toContainText('61.00 GBP');
  await expect(report.getByRole('row', { name: /Total/ })).toContainText('61.00 GBP');

  const download = page.waitForEvent('download');
  await report.getByRole('button', { name: 'Download CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('payroll-2026-03-01-to-2026-03-31.csv');
});
