import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addBranch, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Check-in and front-desk mode (DESIGN.md → "Check-in and front-desk mode";
 * Decisions 315, 317, 320, 351). Staff check a student in by name from
 * Students → Check-in; front-desk mode shows a Branch's classes, short names
 * and recent check-ins; the parts still waiting for their backend (personal
 * code, sign-up, find me, locked exit) are shown switched off.
 */
let s: GradingSchool;
const MIN = 60_000;
const at = (ms: number) => new Date(Date.now() + ms);

async function subscribe(studentId: string) {
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: `Unlimited ${randomUUID().slice(0, 4)}`, price: 5000 } });
  return db.membership.create({ data: { id: randomUUID(), studentId, membershipPlanId: plan.id, schoolId: s.schoolId, status: 'ACTIVE', frequency: 'RECURRING' } });
}

function classNow(data: Record<string, unknown> = {}) {
  return db.class.create({
    data: { id: randomUUID(), schoolId: s.schoolId, title: 'Fundamentals', activities: ['BJJ'], membershipInclusion: true, capacity: 20, startDate: at(-10 * MIN), endDate: at(50 * MIN), ...data },
  });
}

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.booking.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
  await db.class.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

test('staff check a booked student in by name; the line says only "Checked in ✓"', async ({ page }) => {
  const cls = await classNow();
  const m = await subscribe(s.student.id);
  await db.booking.create({ data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: m.id } });
  await signIn(page, s.ownerToken);
  await page.goto('/students');
  await page.getByRole('link', { name: 'Check-in' }).click();
  await expect(page).toHaveURL(/\/check-in$/);

  await expect(page.getByTestId('fd-class')).toContainText('Fundamentals');
  await page.getByRole('tab', { name: 'Name' }).click();
  await page.getByLabel('First or last name').fill('Sam');
  await page.getByRole('button', { name: /Sam Lee/ }).click();

  const card = page.getByTestId('fd-welcome');
  await expect(card).toContainText('Membership active');
  await expect(card.getByRole('button', { name: /Fundamentals/ })).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('button', { name: 'Check in to 1 class' }).click();

  await expect(page.getByText('Checked in ✓')).toBeVisible();
  await expect(page.getByTestId('fd-recent')).toContainText('Sam Lee');
  const booking = await db.booking.findFirstOrThrow({ where: { classId: cls.id, studentId: s.student.id } });
  expect(booking.status).toBe('COMPLETED');
  expect(booking.checkInMethod).toBe('INSTRUCTOR_MANUAL');
});

test('checking in a student who has no booking books the place first', async ({ page }) => {
  const cls = await classNow();
  await subscribe(s.newStudent.id);
  await signIn(page, s.ownerToken);
  await page.goto('/check-in');
  await page.getByRole('tab', { name: 'Name' }).click();
  await page.getByLabel('First or last name').fill('Nia');
  await page.getByRole('button', { name: /Nia Park/ }).click();
  const card = page.getByTestId('fd-welcome');
  await expect(card.getByRole('button', { name: /Fundamentals/ })).toContainText('Books a place');
  await card.getByRole('button', { name: 'Check in to 1 class' }).click();
  await expect(page.getByText('Checked in ✓')).toBeVisible();
  expect((await db.booking.findFirstOrThrow({ where: { classId: cls.id, studentId: s.newStudent.id } })).status).toBe('COMPLETED');
});

test('a refusal from the API is shown as the reason, and nothing is checked in', async ({ page }) => {
  await classNow();
  // No membership: booking the place is refused.
  await signIn(page, s.ownerToken);
  await page.goto('/check-in');
  await page.getByRole('tab', { name: 'Name' }).click();
  await page.getByLabel('First or last name').fill('Nia');
  await page.getByRole('button', { name: /Nia Park/ }).click();
  const card = page.getByTestId('fd-welcome');
  await expect(card).toContainText('No membership');
  await card.getByRole('button', { name: 'Check in to 1 class' }).click();
  await expect(card.getByRole('alert')).toContainText('Not checked in');
  expect(await db.booking.count({ where: { studentId: s.newStudent.id } })).toBe(0);
});

test('the personal code waits for its backend', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/check-in');
  await page.getByRole('tab', { name: 'Code' }).click();
  await expect(page.getByText('Personal check-in codes are coming. Use Scan or Name for now.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check in' })).toBeDisabled();
});

test('front-desk mode: pick the branch, short names, recent check-ins, sign-up waits, exit', async ({ page }) => {
  const branch = await addBranch(s, 'Riverside');
  const cls = await classNow({ branchId: branch.id, title: 'Riverside Fundamentals' });
  await classNow({ title: 'Other branch class' });
  const m = await subscribe(s.student.id);
  await db.booking.create({ data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: m.id, status: 'COMPLETED', checkInMethod: 'SELF_SERVICE' } });
  await signIn(page, s.ownerToken);
  await page.goto('/check-in');
  await page.getByRole('link', { name: 'Front-desk mode' }).click();

  await expect(page.getByRole('heading', { name: 'Start front-desk mode' })).toBeVisible();
  await page.getByRole('radio', { name: 'Riverside' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect(page.getByRole('status').filter({ hasText: /locked yet/ })).toBeVisible();
  await expect(page.getByTestId('fd-class')).toHaveCount(1);
  await expect(page.getByTestId('fd-class')).toContainText('Riverside Fundamentals');
  await expect(page.getByTestId('fd-strip')).toContainText('Sam L.');

  await page.getByRole('tab', { name: 'Name' }).click();
  await page.getByLabel('First or last name').fill('Sam');
  await expect(page.getByRole('button', { name: /Sam L\./ })).toBeVisible();
  await expect(page.getByText('Sam Lee')).toHaveCount(0);

  await page.getByRole('button', { name: /Sign up/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Signing up on this device is coming. For now, ask at the desk.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Send sign-up/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Back to check-in' }).click();

  await page.getByRole('button', { name: 'Exit' }).click();
  await page.getByRole('button', { name: 'Leave' }).click();
  await expect(page).toHaveURL(/\/check-in$/);
});
