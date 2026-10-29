import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 391 — Visitors: the School sets how long a visit pass lasts (no
 * default), the owner gives one from the student's page, and the student then
 * shows as a Visitor on their page and on the Students list.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

test('with no visit pass length set, the student page says where to set it', async ({ page }) => {
  await page.goto(`/students/${s.student.id}`);
  await expect(page.getByRole('heading', { name: 'Visitor', exact: true })).toBeVisible();
  await expect(page.getByText('Set how long a visit pass lasts in School settings to give visit passes.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Give visit pass' })).toHaveCount(0);
});

test('the owner sets the length, gives a pass, and the student shows as a Visitor', async ({ page }) => {
  await page.goto('/school');
  await page.getByLabel('Visit pass length (days)').fill('14');
  await page.getByRole('button', { name: 'Save changes' }).first().click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect.poll(async () => (await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).visitorPeriodDays).toBe(14);

  await page.goto(`/students/${s.student.id}`);
  await expect(page.getByTestId('visitor-status')).toHaveText(/before they choose a membership/);
  await page.getByRole('button', { name: 'Give visit pass' }).click();
  await expect(page.getByTestId('visitor-status')).toHaveText(/Their visit pass ends on/);
  await expect(page.getByRole('button', { name: 'Give another visit pass' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Visit pass/ })).toContainText('Given by the School');

  const pass = await db.membership.findFirstOrThrow({ where: { schoolId: s.schoolId, studentId: s.student.id } });
  expect(pass.giftedById).toBe(s.ownerId);

  await page.goto('/students');
  await expect(page.getByRole('row', { name: new RegExp(s.student.name) }).getByText('Visitor', { exact: true })).toBeVisible();
});
