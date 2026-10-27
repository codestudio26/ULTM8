import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 322 in the portal: the School's check-in and late-cancel settings,
 * the Move/Cancel/Keep choice when a slot edit affects booked classes, "Add to
 * waitlist" when a class is full, and the portal's own wording for the API's
 * coded booking errors.
 */
const WEEKDAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const todayKey = dateKey(new Date());

/**
 * A class time still ahead of us but on today's date. A fixed `now + 2h`
 * spills into tomorrow after 22:00, where the today cell never shows it.
 */
function laterToday(): { occurrenceDate: Date; startDate: Date; endDate: Date } {
  const now = new Date();
  const lastStart = new Date(now);
  lastStart.setHours(23, 50, 0, 0);
  const start = Math.min(now.getTime() + 2 * 3_600_000, Math.max(now.getTime() + 60_000, lastStart.getTime()));
  return {
    occurrenceDate: new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())),
    startDate: new Date(start),
    endDate: new Date(start + 3_600_000),
  };
}
const slotTitle = 'Rules Spec BJJ';

let s: GradingSchool;
let planId = '';

test.beforeEach(async () => {
  s = await seedGradingSchool();
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 },
  });
  planId = plan.id;
  for (const studentId of [s.student.id, s.newStudent.id]) {
    await db.membership.create({
      data: { id: randomUUID(), studentId, membershipPlanId: plan.id, schoolId: s.schoolId, status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null },
    });
  }
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.waitlistEntry.deleteMany({ where });
  await db.booking.deleteMany({ where });
  await db.class.deleteMany({ where });
  await db.timetableSlot.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where: { id: planId } });
});

test.afterAll(async () => {
  await cleanup();
});

/** A slot on today's weekday (so the Week view shows it on today) with one class. */
async function slotWithClass(cls: { startDate: Date; endDate: Date; occurrenceDate: Date; capacity?: number }) {
  const slot = await db.timetableSlot.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      weekday: WEEKDAY_NAMES[new Date().getDay()],
      startTime: new Date(Date.UTC(1970, 0, 1, 18, 0)),
      endTime: new Date(Date.UTC(1970, 0, 1, 19, 0)),
      title: slotTitle,
      activities: ['BJJ'],
      styles: [{ disciplineId: s.disciplineId, classType: null }],
      capacity: cls.capacity ?? null,
      status: 'ON',
    },
  });
  const created = await db.class.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      timetableSlotId: slot.id,
      title: slotTitle,
      activities: ['BJJ'],
      styles: [{ disciplineId: s.disciplineId, classType: null }],
      ...cls,
    },
  });
  return { slotId: slot.id, classId: created.id };
}

async function bookDirectly(classId: string, studentId: string) {
  const membership = await db.membership.findFirstOrThrow({ where: { studentId, schoolId: s.schoolId } });
  await db.booking.create({ data: { id: randomUUID(), studentId, classId, schoolId: s.schoolId, sourceMembershipId: membership.id } });
}

test('the School sets when check-in opens and what a late cancel refunds', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/school');
  await page.getByLabel('Check-in opens (minutes before class)').fill('45');
  await page.getByLabel('Cancelling after a class starts').selectOption({ label: 'Refund until the class ends' });
  await page.getByRole('button', { name: 'Save changes' }).first().click();

  await expect(page.getByText('Saved.')).toBeVisible();
  const school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(school.checkInOpensMinutesBeforeStart).toBe(45);
  expect(school.lateCancelRefundPolicy).toBe('REFUND_UNTIL_END');
});

test('editing a slot with booked classes asks Move, Cancel or Keep, and Move keeps the booking', async ({ page }) => {
  const next = new Date();
  next.setDate(next.getDate() + 7);
  const occurrenceDate = new Date(Date.UTC(next.getFullYear(), next.getMonth(), next.getDate()));
  const { slotId, classId } = await slotWithClass({
    occurrenceDate,
    startDate: new Date(occurrenceDate.getTime() + 18 * 3_600_000),
    endDate: new Date(occurrenceDate.getTime() + 19 * 3_600_000),
  });
  await bookDirectly(classId, s.student.id);

  await signIn(page, s.ownerToken);
  // The class is a week ahead: the calendar shows real Classes (Decision 353).
  await page.goto('/timetable');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: `Actions for ${slotTitle} on ${dateKey(next)}` }).click();
  await page.getByRole('menuitem', { name: 'Edit slot' }).click();
  const form = page.getByRole('dialog', { name: 'Edit timetable slot' });
  await form.getByLabel('Start time').fill('17:00');
  await form.getByRole('button', { name: 'Save' }).click();

  const choice = page.getByRole('dialog', { name: 'Some upcoming classes have bookings' });
  await expect(choice).toBeVisible();
  await expect(choice.getByText('Upcoming classes from this slot with bookings or a waitlist: 1. Students booked: 1.')).toBeVisible();
  await expect(choice.getByLabel(/Move them/)).toBeChecked();
  await choice.getByRole('button', { name: 'Save change' }).click();

  await expect(choice).toHaveCount(0);
  await expect(form).toHaveCount(0);
  const slot = await db.timetableSlot.findUniqueOrThrow({ where: { id: slotId } });
  expect(slot.startTime.getUTCHours()).toBe(17);
  const moved = await db.class.findUniqueOrThrow({ where: { id: classId } });
  expect(moved.startDate.getUTCHours()).toBe(17);
  expect(await db.booking.count({ where: { classId, studentId: s.student.id, status: 'UPCOMING' } })).toBe(1);
});

test('a slot edit that only changes unbooked classes saves without asking', async ({ page }) => {
  const next = new Date();
  next.setDate(next.getDate() + 7);
  const occurrenceDate = new Date(Date.UTC(next.getFullYear(), next.getMonth(), next.getDate()));
  const { slotId } = await slotWithClass({
    occurrenceDate,
    startDate: new Date(occurrenceDate.getTime() + 18 * 3_600_000),
    endDate: new Date(occurrenceDate.getTime() + 19 * 3_600_000),
  });

  await signIn(page, s.ownerToken);
  // The class is a week ahead: the calendar shows real Classes (Decision 353).
  await page.goto('/timetable');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: `Actions for ${slotTitle} on ${dateKey(next)}` }).click();
  await page.getByRole('menuitem', { name: 'Edit slot' }).click();
  const form = page.getByRole('dialog', { name: 'Edit timetable slot' });
  await form.getByLabel('Start time').fill('17:30');
  await form.getByRole('button', { name: 'Save' }).click();

  await expect(form).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Some upcoming classes have bookings' })).toHaveCount(0);
  const slot = await db.timetableSlot.findUniqueOrThrow({ where: { id: slotId } });
  expect(slot.startTime.getUTCMinutes()).toBe(30);
});

test('a full class offers "Add to waitlist" and adds the Student', async ({ page }) => {
  const { classId } = await slotWithClass({ ...laterToday(), capacity: 1 });
  await bookDirectly(classId, s.newStudent.id);

  await signIn(page, s.ownerToken);
  await page.goto('/timetable');
  await page.getByRole('button', { name: `Actions for ${slotTitle} on ${todayKey}` }).click();
  await page.getByRole('menuitem', { name: 'Book' }).click();
  const dialog = page.getByRole('dialog', { name: `Book — ${slotTitle}` });
  await dialog.getByLabel('Student').selectOption({ label: s.student.name });
  await dialog.getByRole('button', { name: 'Confirm' }).click();

  await expect(dialog.getByText('This class is full. You can add the student to the waitlist instead.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add to waitlist' }).click();

  await expect(page.getByText(`Added to the waitlist for ${slotTitle} on ${todayKey}, at position 1.`)).toBeVisible();
  expect(await db.waitlistEntry.count({ where: { classId, studentId: s.student.id, status: 'WAITING' } })).toBe(1);
});

test("a coded booking error is shown in the portal's own words", async ({ page }) => {
  await slotWithClass(laterToday());
  await page.route('**/v1/classes/*/book', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'CLASS_BUSY', message: 'This Class is very busy right now. Please try again in a moment.' } }),
    }),
  );

  await signIn(page, s.ownerToken);
  await page.goto('/timetable');
  await page.getByRole('button', { name: `Actions for ${slotTitle} on ${todayKey}` }).click();
  await page.getByRole('menuitem', { name: 'Book' }).click();
  const dialog = page.getByRole('dialog', { name: `Book — ${slotTitle}` });
  await dialog.getByLabel('Student').selectOption({ label: s.student.name });
  await dialog.getByRole('button', { name: 'Confirm' }).click();

  await expect(dialog.getByText('Lots of people are booking this class right now. Please try again in a moment.')).toBeVisible();
  // Not full: Confirm stays the next step, no waitlist offer.
  await expect(dialog.getByRole('button', { name: 'Add to waitlist' })).toHaveCount(0);
});
