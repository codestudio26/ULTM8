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
  await db.waiverSignature.deleteMany({ where });
  await db.waiver.deleteMany({ where });
  await db.trainingLog.deleteMany({ where });
  await db.bookingAttendee.deleteMany({ where });
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

test('one class that can\'t be done stops the whole check-in, and says which (Decision 378)', async ({ page }) => {
  const fine = await classNow();
  const full = await classNow({ title: 'Sparring', capacity: 1 });
  const m = await subscribe(s.newStudent.id);
  const booking = await db.booking.create({ data: { id: randomUUID(), studentId: s.newStudent.id, classId: fine.id, schoolId: s.schoolId, sourceMembershipId: m.id } });
  const other = await subscribe(s.student.id);
  await db.booking.create({ data: { id: randomUUID(), studentId: s.student.id, classId: full.id, schoolId: s.schoolId, sourceMembershipId: other.id } });
  await signIn(page, s.ownerToken);
  await page.goto('/check-in');
  await page.getByRole('tab', { name: 'Name' }).click();
  await page.getByLabel('First or last name').fill('Nia');
  await page.getByRole('button', { name: /Nia Park/ }).click();
  const card = page.getByTestId('fd-welcome');
  await card.getByRole('button', { name: /Sparring/ }).click();
  await card.getByRole('button', { name: 'Check in to 2 classes' }).click();
  await expect(card.getByRole('alert')).toContainText('Sparring:');
  await expect(card.getByRole('alert')).toContainText('full');
  // All or nothing: the class that was fine wasn't checked in either.
  expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('UPCOMING');
  expect(await db.booking.count({ where: { studentId: s.newStudent.id, classId: full.id } })).toBe(0);
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
  const other = await addBranch(s, 'Hilltop');
  await classNow({ branchId: other.id, title: 'Other branch class' });
  // A Whole School class is on at every Branch (CI3).
  await classNow({ title: 'Whole School class', startDate: at(-5 * MIN) });
  const m = await subscribe(s.student.id);
  await db.booking.create({ data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: m.id, status: 'COMPLETED', checkInMethod: 'SELF_SERVICE' } });
  await signIn(page, s.ownerToken);
  await page.goto('/check-in');
  await page.getByRole('link', { name: 'Front-desk mode' }).click();

  await expect(page.getByRole('heading', { name: 'Start front-desk mode' })).toBeVisible();
  await page.getByRole('radio', { name: 'Riverside' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  await expect(page.getByRole('status').filter({ hasText: /locked yet/ })).toBeVisible();
  await expect(page.getByTestId('fd-class')).toHaveCount(2);
  await expect(page.getByTestId('fd-class').first()).toContainText('Riverside Fundamentals');
  await expect(page.getByTestId('fd-class').nth(1)).toContainText('Whole School class');
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

test('a class whose check-in hasn\'t opened can\'t be ticked, so nothing is booked for it (CI2)', async ({ page }) => {
  await classNow();
  const later = await classNow({ title: 'Evening class', startDate: at(180 * MIN), endDate: at(240 * MIN) });
  await subscribe(s.newStudent.id);
  await signIn(page, s.ownerToken);
  await page.goto('/check-in');
  await page.getByRole('tab', { name: 'Name' }).click();
  await page.getByLabel('First or last name').fill('Nia');
  await page.getByRole('button', { name: /Nia Park/ }).click();
  const card = page.getByTestId('fd-welcome');
  const evening = card.getByRole('button', { name: /Evening class/ });
  await expect(evening).toBeDisabled();
  await expect(evening).toContainText('Check-in opens at');
  await expect(card.getByRole('button', { name: /Fundamentals/ })).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('button', { name: 'Check in to 1 class' }).click();
  await expect(page.getByText('Checked in ✓')).toBeVisible();
  expect(await db.booking.count({ where: { classId: later.id } })).toBe(0);
});

test('only a later class today: nothing is ticked and Confirm stays off', async ({ page }) => {
  await classNow({ title: 'Evening class', startDate: at(180 * MIN), endDate: at(240 * MIN) });
  await subscribe(s.newStudent.id);
  await signIn(page, s.ownerToken);
  await page.goto('/check-in');
  await page.getByRole('tab', { name: 'Name' }).click();
  await page.getByLabel('First or last name').fill('Nia');
  await page.getByRole('button', { name: /Nia Park/ }).click();
  const card = page.getByTestId('fd-welcome');
  await expect(card.getByRole('button', { name: /Evening class/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(card.getByRole('button', { name: 'Tick a class' })).toBeDisabled();
});

test('the welcome card shows which waivers are still to sign (Q4)', async ({ page }) => {
  await classNow();
  const signedOne = await db.waiver.create({ data: { id: randomUUID(), schoolId: s.schoolId, title: 'Liability', body: 'Text' } });
  await db.waiver.create({ data: { id: randomUUID(), schoolId: s.schoolId, title: 'Photo consent', body: 'Text' } });
  await db.waiverSignature.create({
    data: { id: randomUUID(), waiverId: signedOne.id, studentId: s.student.id, schoolId: s.schoolId, status: 'SIGNED', signerFullName: 'Sam Lee', signatureText: 'Sam Lee', signedDate: new Date() },
  });
  await signIn(page, s.ownerToken);
  await page.goto('/check-in');
  await page.getByRole('tab', { name: 'Name' }).click();
  await page.getByLabel('First or last name').fill('Sam');
  await page.getByRole('button', { name: /Sam Lee/ }).click();
  await expect(page.getByTestId('fd-welcome')).toContainText('Waiver to sign: Photo consent');
});

test('a School with no Branches starts front-desk mode for the whole School (CI4)', async ({ page }) => {
  await classNow({ title: 'Whole School class' });
  await signIn(page, s.ownerToken);
  await page.goto('/front-desk');
  await expect(page.getByText('Whole School')).toBeVisible();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('fd-class')).toContainText('Whole School class');
});

test('each guest is ticked on their own; the member\'s check-in doesn\'t check them in (Decision 377)', async ({ page }) => {
  const cls = await classNow();
  const m = await subscribe(s.student.id);
  const booking = await db.booking.create({ data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: m.id } });
  const guests = [];
  for (let i = 0; i < 2; i++) {
    guests.push(await db.bookingAttendee.create({ data: { id: randomUUID(), bookingId: booking.id, schoolId: s.schoolId, membershipId: m.id, createdAt: at(i * 1000) } }));
  }
  await db.waiver.create({ data: { id: randomUUID(), schoolId: s.schoolId, title: 'Liability', body: 'Text' } });
  await signIn(page, s.ownerToken);
  await page.goto('/check-in');
  await page.getByRole('tab', { name: 'Name' }).click();
  await page.getByLabel('First or last name').fill('Sam');
  await page.getByRole('button', { name: /Sam Lee/ }).click();
  const card = page.getByTestId('fd-welcome');
  await expect(card.getByTestId('fd-guests').getByRole('button')).toHaveCount(2);
  await expect(card.getByRole('button', { name: /Guest 1/ })).toContainText('Waiver not signed');
  await expect(card.getByRole('button', { name: /Guest 1/ })).toHaveAttribute('aria-pressed', 'false');
  await card.getByRole('button', { name: /Guest 1/ }).click();
  await card.getByRole('button', { name: 'Check in to 1 class + 1 guest' }).click();
  await expect(page.getByText('Checked in ✓')).toBeVisible();

  const rows = await db.bookingAttendee.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: 'asc' } });
  expect(rows[0].checkedInAt).not.toBeNull();
  expect(rows[1].checkedInAt).toBeNull();
  expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('COMPLETED');

  // The second guest arrives later: only the guest is left to tick.
  await page.getByRole('tab', { name: 'Name' }).click();
  await page.getByLabel('First or last name').fill('Sam');
  await page.getByRole('button', { name: /Sam Lee/ }).click();
  await expect(card.getByRole('button', { name: /Guest 1/ })).toBeDisabled();
  await card.getByRole('button', { name: /Guest 2/ }).click();
  await card.getByRole('button', { name: 'Check in 1 guest' }).click();
  await expect(page.getByText('Checked in ✓')).toBeVisible();
  expect((await db.bookingAttendee.findUniqueOrThrow({ where: { id: guests[1].id } })).checkedInAt).not.toBeNull();
});

