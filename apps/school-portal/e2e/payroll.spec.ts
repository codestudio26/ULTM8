import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/** Picks an option in one of the new look's own drop-downs (DESIGN.md →
 * "Drop-downs"): a combobox named by its label, then the option by its text. */
async function choose(scope: Page | Locator, label: string, option: string) {
  const field = scope.getByRole('combobox', { name: label, exact: true });
  await field.click();
  await scope.getByRole('option', { name: option, exact: true }).click();
  await expect(field.locator('[data-shown="true"]')).toHaveText(option);
}

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

/** Downloads the report's CSV and returns its lines (without the byte-order mark). */
async function downloadCsvLines(page: Page, report: Locator): Promise<string[]> {
  const download = page.waitForEvent('download');
  await report.getByRole('button', { name: 'Download CSV' }).click();
  const file = await download;
  const text = await readFile((await file.path()) as string, 'utf8');
  return text.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
}

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
  await choose(report, 'Dates', 'Custom dates');
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

test('Decision 435 item 22: Branch Staff see the payroll report only once the owner switches "Payroll" on, for the whole School: never the Rates tab, and the rates only if the owner chooses', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const bea = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  await db.staffPayRate.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: coachId, hourlyRate: 2000, perClassRate: 550 } });

  // Off by default: no Payroll in the menu, and the page says so.
  await signIn(page, bea.token);
  await page.goto('/payroll');
  await expect(page.getByText("Only the School's owners, and staff they allow, can see payroll.")).toBeVisible();
  await expect(page.getByRole('link', { name: 'Payroll' })).toHaveCount(0);

  // The owner turns it on; it is in neither preset.
  await signIn(page, s.ownerToken);
  await page.goto('/staff');
  const row = page.locator('.ultm8-card').filter({ hasText: 'Your staff' }).getByRole('row').filter({ hasText: 'Bea Desk' });
  await row.getByRole('button', { name: 'Actions for Bea Desk' }).click();
  await page.getByRole('menuitem', { name: 'Access' }).click();
  const dialog = page.getByRole('dialog', { name: 'Access for Bea Desk' });
  await expect(dialog.getByLabel('Payroll', { exact: true })).not.toBeChecked();
  await dialog.getByLabel('Payroll', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Access saved for Bea Desk.')).toBeVisible();
  expect((await db.staffPermission.findFirstOrThrow({ where: { userId: bea.id } })).canSeePayroll).toBe(true);

  // The coach teaches at no Branch of Bea's, yet she sees what they earned.
  await signIn(page, bea.token);
  await page.goto('/timetable');
  // Payroll is in Billing, Bea's only page there.
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: 'Billing' }).click();
  await expect(page).toHaveURL(/\/payroll$/);
  const report = page.getByTestId('payroll-report');
  await choose(report, 'Dates', 'Custom dates');
  await report.getByLabel('From').fill('2026-03-01');
  await report.getByLabel('To').fill('2026-03-31');
  await expect(report.getByRole('row', { name: /Cora Coach/ })).toContainText('61.00 GBP');
  // The report only (owner's answer, 6 Nov 2026): no Rates tab, so no rate to edit.
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByTestId('payroll-rates')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /rate/i })).toHaveCount(0);

  // The rates themselves are hidden from her by default (owner's answer, 6 Nov
  // 2026): classes, hours and pay only, on the page and in the CSV.
  await expect(page.getByTestId('payroll-rates-hidden')).toBeVisible();
  await expect(report.getByRole('columnheader', { name: 'Hourly rate' })).toHaveCount(0);
  await expect(report.getByRole('columnheader', { name: 'Per-class rate' })).toHaveCount(0);
  await expect(report.getByRole('row', { name: /Cora Coach/ })).not.toContainText('20.00 GBP');
  // Her subtitle names the owners' rates, not hers.
  await expect(page.getByText("at the rates the School's owners set")).toBeVisible();
  const hidden = await downloadCsvLines(page, report);
  expect(hidden[0]).toBe('Staff member,Classes taught,Hours,Pay,Currency');
  expect(hidden.find((l) => l.startsWith('Cora Coach'))).toBe('Cora Coach,2,2.5,61.00,GBP');

  // The owner chooses to show them, on the Rates tab.
  await signIn(page, s.ownerToken);
  await page.goto('/payroll');
  await page.getByRole('tab', { name: 'Rates' }).click();
  const setting = page.getByTestId('payroll-staff-rates-setting');
  const show = setting.getByLabel('Show pay rates in the report');
  await expect(show).not.toBeChecked();
  await show.check();
  await expect(setting.getByText('Saved')).toBeVisible();
  await expect(show).toBeChecked();
  await expect.poll(async () => (await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).payrollStaffSeeRates).toBe(true);

  // Now she sees them, read only, on the page and in the CSV.
  await signIn(page, bea.token);
  await page.goto('/payroll');
  await choose(report, 'Dates', 'Custom dates');
  await report.getByLabel('From').fill('2026-03-01');
  await report.getByLabel('To').fill('2026-03-31');
  const cora = report.getByRole('row', { name: /Cora Coach/ });
  await expect(cora).toContainText('20.00 GBP');
  await expect(cora).toContainText('5.50 GBP');
  await expect(page.getByTestId('payroll-rates-hidden')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /rate/i })).toHaveCount(0);
  const shown = await downloadCsvLines(page, report);
  expect(shown[0]).toBe('Staff member,Classes taught,Hours,Hourly rate,Per-class rate,Pay,Currency');
  expect(shown.find((l) => l.startsWith('Cora Coach'))).toBe('Cora Coach,2,2.5,20.00,5.50,61.00,GBP');
});
