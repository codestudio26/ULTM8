import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Membership card (backlog 3.11, Decision 398): staff print a bank-card-sized
 * card from the student's page. It shows the School, the student's name, their
 * check-in code and their memberships, and never a QR code.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  await db.membership.deleteMany({ where: { schoolId: s.schoolId } });
  await db.membershipPlan.deleteMany({ where: { schoolId: s.schoolId } });
});

test.afterAll(async () => {
  await cleanup();
});

test('Print membership card opens the card: School, name, code and membership, with no QR', async ({ page }) => {
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: '10 classes', price: 5000 } });
  await db.membership.create({
    data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: plan.id, schoolId: s.schoolId, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining: 3 },
  });
  await page.goto(`/students/${s.student.id}`);
  const code = ((await page.getByTestId('student-check-in-code').textContent()) ?? '').trim();

  const [card] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Print membership card' }).click()]);
  await card.waitForLoadState();
  await expect(card).toHaveTitle('Sam Lee: membership card');
  const school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  await expect(card.getByText(school.name)).toBeVisible();
  await expect(card.getByText('Sam Lee')).toBeVisible();
  await expect(card.getByText(code, { exact: true })).toBeVisible();
  await expect(card.getByText('10 classes · 3 classes left')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Print / Save as PDF' })).toBeVisible();
  // No QR: no picture or drawing other than the student's initials.
  expect(await card.locator('svg, canvas, img').count()).toBe(0);
});

test('a student with no membership: the card says so', async ({ page }) => {
  await page.goto(`/students/${s.student.id}`);
  const [card] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: 'Print membership card' }).click()]);
  await card.waitForLoadState();
  await expect(card.getByText('No current membership')).toBeVisible();
});
