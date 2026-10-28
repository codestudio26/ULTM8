import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Timetable page redesign (v1.2 backend backlog, "Timetable page") — the three
 * Day/Week/Month range views, the Rows/Grid layout toggle, and the click-to-book
 * confirmation dialog wired to the real calendar (`GET /schools/:id/timetable/calendar`,
 * Decision 353) + `POST /classes/:id/book` endpoints. No mockup was reachable this session (see
 * TimetablePage.tsx's own header comment) — this models its structure on
 * classes-filter.spec.ts/dashboard.spec.ts's own house style, same as every
 * other redesign spec this session.
 *
 * `slotWeekday`/`todayKey` are derived from the ACTUAL run date rather than a
 * fixed fixture date — the page's own Day/Week default range is always anchored
 * on "today", so the fixture has to track it instead of assuming e.g. "today is
 * always a Monday".
 */
const WEEKDAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;

function todayWeekday(): (typeof WEEKDAY_NAMES)[number] {
  return WEEKDAY_NAMES[new Date().getDay()];
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const todayKey = dateKey(new Date());
const slotTitle = 'Spec BJJ Fundamentals';

let s: GradingSchool;
let slotId = '';
let classId = '';
let bookingId = '';
let membershipId = '';
let membershipPlanId = '';

test.beforeEach(async () => {
  s = await seedGradingSchool();

  // Booking requires the Student to hold an Active Membership for this School
  // (SKILL.md §10) — seedGradingSchool's own students are grading fixtures with
  // none, so this spec gives Sam Lee one itself, same shape dashboard.spec.ts's
  // own Bookings fixture already uses.
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 },
  });
  membershipPlanId = plan.id;
  const membership = await db.membership.create({
    data: {
      id: randomUUID(), studentId: s.student.id, membershipPlanId: plan.id, schoolId: s.schoolId,
      status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null,
    },
  });
  membershipId = membership.id;

  const slot = await db.timetableSlot.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      weekday: todayWeekday(),
      // Late evening, so today's class hasn't ended whenever CI runs (the
      // booking dialog refuses an ended class, Decision 332).
      startTime: new Date(Date.UTC(1970, 0, 1, 23, 0)),
      endTime: new Date(Date.UTC(1970, 0, 1, 23, 59)),
      title: slotTitle,
      activities: ['BJJ'],
      status: 'ON',
    },
  });
  slotId = slot.id;

  // Materialized for TODAY only: the calendar shows real Classes (Decision 353).
  const today = new Date();
  const cls = await db.class.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      timetableSlotId: slot.id,
      occurrenceDate: new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())),
      title: slotTitle,
      activities: ['BJJ'],
      startDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 0),
      endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59),
    },
  });
  classId = cls.id;
});

test.afterEach(async () => {
  if (bookingId) await db.booking.delete({ where: { id: bookingId } }).catch(() => undefined);
  await db.class.delete({ where: { id: classId } }).catch(() => undefined);
  await db.timetableSlot.delete({ where: { id: slotId } }).catch(() => undefined);
  await db.membership.delete({ where: { id: membershipId } }).catch(() => undefined);
  await db.membershipPlan.delete({ where: { id: membershipPlanId } }).catch(() => undefined);
  bookingId = '';
  classId = '';
  slotId = '';
  membershipId = '';
  membershipPlanId = '';
});

test.afterAll(async () => {
  await cleanup();
});

test('picking today\'s occurrence opens the booking dialog, gates Confirm on a Student, and books successfully', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/timetable');

  const trigger = page.getByRole('button', { name: `Actions for ${slotTitle} on ${todayKey}` });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Book' }).click();

  const dialog = page.getByRole('dialog', { name: `Book — ${slotTitle}` });
  await expect(dialog).toBeVisible();
  // Two matches for the title — the dialog's own heading plus the "Class" field's
  // read-only value — `.last()` targets the field, the heading is already covered
  // by the dialog's own accessible name assertion above.
  await expect(dialog.getByText(slotTitle).last()).toBeVisible();

  const confirmBtn = dialog.getByRole('button', { name: 'Confirm' });
  await expect(confirmBtn).toBeDisabled();

  await dialog.getByLabel('Student').selectOption({ label: 'Sam Lee' });
  await expect(confirmBtn).toBeEnabled();
  await confirmBtn.click();

  await expect(page.getByText(`Booked ${slotTitle} on ${todayKey}.`)).toBeVisible();
  await expect(dialog).toHaveCount(0);

  const created = await db.booking.findFirst({ where: { classId, studentId: s.student.id } });
  expect(created).not.toBeNull();
  if (created) bookingId = created.id;
});

test('a date past the 4-week horizon shows "Opens for booking later" and no Book (Decision 353)', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/timetable');
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Next' }).click();

  const laterKey = dateKey(new Date(Date.now() + 42 * 86_400_000));
  const trigger = page.getByRole('button', { name: `Actions for ${slotTitle} on ${laterKey}` });
  await expect(trigger).toBeVisible();
  await expect(page.getByText('Opens for booking later')).toBeVisible();
  await trigger.click();
  await expect(page.getByRole('menuitem', { name: 'Edit slot' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Book' })).toHaveCount(0);
});

test('Day/Week/Month and Rows/Grid both keep today\'s occurrence visible', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/timetable');

  // Week + Rows is the default.
  await expect(page.getByText(slotTitle).first()).toBeVisible();

  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(page.getByText(slotTitle).first()).toBeVisible();

  await page.getByRole('button', { name: 'Day', exact: true }).click();
  await expect(page.getByText(slotTitle).first()).toBeVisible();

  await page.getByRole('button', { name: 'Rows', exact: true }).click();
  await expect(page.getByText(slotTitle).first()).toBeVisible();

  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await expect(page.getByRole('button', { name: `Book ${slotTitle} on ${todayKey}` })).toBeVisible();
});
