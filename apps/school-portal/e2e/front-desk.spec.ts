import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addBranch, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Check-in and front-desk mode (DESIGN.md → "Check-in and front-desk mode";
 * Decisions 315, 317, 320, 351, 380). Staff check a student in by name from
 * Students → Check-in; front-desk mode is a locked tablet that shows a
 * Branch's classes, short names and recent check-ins, and is left with a
 * staff member's own code; a student's personal code opens their card
 * (Decision 384); Find me answers only yes or no (Decision 385); sign-up,
 * still waiting for its backend, is shown switched off.
 */
let s: GradingSchool;
const MIN = 60_000;
const at = (ms: number) => new Date(Date.now() + ms);

// The Check-in page asks for "today" by the browser's own day, and these
// tests seed classes from 10 minutes ago to 4 hours ahead. Run the browser in
// a fixed-offset zone where it is about 9 in the morning, so "today" never
// ends mid-test, whatever time CI runs. (Etc/GMT-N is UTC+N.)
const offset = ((9 - new Date().getUTCHours() + 36) % 24) - 12;
test.use({ timezoneId: offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}` });

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
  await db.frontDeskSession.deleteMany({ where });
  await db.staffKioskCode.deleteMany({ where });
  await db.studentCheckInCode.deleteMany({ where });
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

test('a student\'s personal code is on their page, and typing it at the desk checks them in as a code (Decision 384)', async ({ page }) => {
  const cls = await classNow();
  await subscribe(s.student.id);
  await signIn(page, s.ownerToken);
  await page.goto(`/students/${s.student.id}`);
  const code = ((await page.getByTestId('student-check-in-code').textContent()) ?? '').trim();
  expect(code).toMatch(/^\d{4}$/);

  await page.goto('/check-in');
  await page.getByRole('tab', { name: 'Code' }).click();
  const typeCode = async (c: string) => {
    for (const d of c) await page.getByRole('button', { name: d, exact: true }).click();
    await page.getByRole('button', { name: 'Check in', exact: true }).click();
  };
  await typeCode(code === '0000' ? '1111' : '0000');
  await expect(page.getByText('We couldn’t find that code. Try again, or find your name.')).toBeVisible();
  await typeCode(code);
  const card = page.getByTestId('fd-welcome');
  await expect(card).toContainText('Sam');
  await card.getByRole('button', { name: 'Check in to 1 class' }).click();
  await expect(page.getByText('Checked in ✓')).toBeVisible();
  const booking = await db.booking.findFirstOrThrow({ where: { classId: cls.id, studentId: s.student.id } });
  expect(booking.checkInMethod).toBe('PERSONAL_CODE');

  // A new code replaces the old one.
  await page.goto(`/students/${s.student.id}`);
  await page.getByRole('button', { name: 'Give a new code' }).click();
  await page.getByRole('button', { name: 'Yes, new code' }).click();
  await expect(page.getByTestId('student-check-in-code')).not.toHaveText(code);
});

test('on the tablet, a 4-digit code still works after the School moves to 6 digits (Decision 384)', async ({ page }) => {
  const cls = await classNow();
  await subscribe(s.newStudent.id);
  await db.studentCheckInCode.create({ data: { schoolId: s.schoolId, studentId: s.newStudent.id, code: '4821' } });
  await db.school.update({ where: { id: s.schoolId }, data: { checkInCodeDigits: 6 } });
  await signIn(page, s.ownerToken);
  await page.goto('/front-desk');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page).toHaveURL(/\/front-desk\/kiosk$/);

  await page.getByRole('tab', { name: 'Code' }).click();
  await expect(page.getByText('Your 6-digit check-in code. Ask at the desk if you don’t know it.')).toBeVisible();
  for (const d of '4821') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Check in', exact: true }).click();
  const card = page.getByTestId('fd-welcome');
  await expect(card).toContainText('Welcome back, Nia');
  await card.getByRole('button', { name: 'Check in to 1 class' }).click();
  await expect(page.getByText('You’re in, Nia')).toBeVisible();
  const booking = await db.booking.findFirstOrThrow({ where: { classId: cls.id, studentId: s.newStudent.id } });
  expect(booking.checkInMethod).toBe('PERSONAL_CODE');
});

test('front-desk mode: a locked tablet with the branch\'s classes, short names, check-in, and exit with a staff code (Decision 380)', async ({ page }) => {
  const branch = await addBranch(s, 'Riverside');
  const cls = await classNow({ branchId: branch.id, title: 'Riverside Fundamentals' });
  const other = await addBranch(s, 'Hilltop');
  await classNow({ branchId: other.id, title: 'Other branch class' });
  // A Whole School class is on at every Branch (CI3).
  const whole = await classNow({ title: 'Whole School class', startDate: at(-5 * MIN) });
  const m = await subscribe(s.student.id);
  await db.booking.create({ data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: m.id, status: 'COMPLETED', checkInMethod: 'SELF_SERVICE' } });
  await subscribe(s.newStudent.id);
  await signIn(page, s.ownerToken);
  await page.goto('/check-in');
  await page.getByRole('link', { name: 'Front-desk mode' }).click();

  await expect(page.getByRole('heading', { name: 'Start front-desk mode' })).toBeVisible();
  const myCode = ((await page.getByTestId('fd-my-code').textContent()) ?? '').match(/(\d{4})/)?.[1] ?? '';
  expect(myCode).toMatch(/^\d{4}$/);
  await page.getByRole('radio', { name: 'Riverside' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  // The device now holds only the tablet's session, not the owner's login.
  await expect(page).toHaveURL(/\/front-desk\/kiosk$/);
  await expect(page.getByTestId('fd-class')).toHaveCount(2);
  await expect(page.getByTestId('fd-class').first()).toContainText('Riverside Fundamentals');
  await expect(page.getByTestId('fd-class').nth(1)).toContainText('Whole School class');
  await expect(page.getByTestId('fd-strip')).toContainText('Sam L.');
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => /token/i.test(k) && sessionStorage.getItem(k)))).toEqual([]);

  await page.getByRole('tab', { name: 'Name' }).click();
  await page.getByLabel('First or last name').fill('Sam');
  await expect(page.getByRole('button', { name: /Sam L\./ })).toBeVisible();
  await expect(page.getByText('Sam Lee')).toHaveCount(0);

  await page.getByLabel('First or last name').fill('Nia');
  await page.getByRole('button', { name: /Nia P\./ }).click();
  const card = page.getByTestId('fd-welcome');
  await expect(card).toContainText('Welcome back, Nia');
  await card.getByRole('button', { name: /Whole School class/ }).click();
  await card.getByRole('button', { name: /Riverside Fundamentals/ }).click();
  await card.getByRole('button', { name: 'Check in to 1 class' }).click();
  await expect(page.getByText('You’re in, Nia')).toBeVisible();
  const booking = await db.booking.findFirstOrThrow({ where: { studentId: s.newStudent.id, classId: whole.id } });
  expect(booking.status).toBe('COMPLETED');
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: /Sign up/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Signing up on this device is coming. For now, ask at the desk.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Send sign-up/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Back to check-in' }).click();

  await page.getByRole('button', { name: 'Exit' }).click();
  const exit = page.getByRole('dialog', { name: 'Leave front-desk mode' });
  const typeCode = async (code: string) => {
    for (const d of code) await exit.getByRole('button', { name: d, exact: true }).click();
    await exit.getByRole('button', { name: 'Unlock' }).click();
  };
  const wrong = myCode === '0000' ? '1111' : '0000';
  await typeCode(wrong);
  await expect(exit).toContainText(/That staff code isn.t right/);
  await typeCode(myCode);
  await expect(page.getByRole('heading', { name: /Unlocked by Olive/ })).toBeVisible();
  await page.getByRole('button', { name: 'Staff sign-in' }).click();
  await expect(page).toHaveURL(/\/login/);
});

test('find me on the tablet says only whether you\'re already a member (Decision 385)', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/front-desk');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page).toHaveURL(/\/front-desk\/kiosk$/);
  await page.getByRole('button', { name: /Sign up/ }).click();
  await page.getByRole('button', { name: 'Already a member? Find me' }).click();

  await page.getByLabel('Your full name').fill('Sam Lee');
  await page.getByLabel('Date of birth').fill('2000-01-02');
  await page.getByRole('button', { name: 'Find me', exact: true }).click();
  await expect(page.getByText('We couldn’t find you. You can sign up instead.')).toBeVisible();

  await page.getByLabel('Date of birth').fill('2000-01-01');
  await page.getByRole('button', { name: 'Find me', exact: true }).click();
  await expect(page.getByText('You’re already a member here')).toBeVisible();
  // Nothing stored about them is shown.
  await expect(page.getByText(/@/)).toHaveCount(0);
});

test('staff see a tablet on the Check-in page and can end it there (Decision 380)', async ({ page, browser }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/front-desk');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page).toHaveURL(/\/front-desk\/kiosk$/);

  const staff = await (await browser.newContext()).newPage();
  await signIn(staff, s.ownerToken);
  await staff.goto('/check-in');
  const tablets = staff.getByTestId('fd-tablets');
  await expect(tablets).toContainText('Whole School');
  await tablets.getByRole('button', { name: 'End' }).click();
  await expect(tablets).toContainText('No device is in front-desk mode.');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Front-desk mode has ended' })).toBeVisible();
  await staff.context().close();
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

