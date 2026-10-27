import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 332 in the portal (Timetable review, 26 Oct 2026): Archive asks
 * first (T10), a break can be cleared (T9), a booking-rule change asks Apply or
 * Keep for booked classes (T6), a capacity cut below seats booked only asks to
 * confirm and leaves fuller classes their size (T5), every slot loads past the
 * first page of 20 (T14), and a cancelled class says so instead of offering
 * Confirm (T13).
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
// slotWithClass's default class is a week ahead; the calendar shows real
// Classes (Decision 353), so tests open next week to find it.
const nextKey = dateKey(new Date(Date.now() + 7 * 86_400_000));
const slotTitle = 'Review Fixes BJJ';

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
  await db.studentHomeBranch.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where: { id: planId } });
});

test.afterAll(async () => {
  await cleanup();
});

/** A slot on today's weekday (so the Week view shows it on today), with one
 * class a week from today unless `cls` says otherwise. */
async function slotWithClass(opts: { capacity?: number; breakStart?: Date; breakEnd?: Date; cls?: { occurrenceDate: Date; startDate: Date; endDate: Date; archivedAt?: Date; cancelledAt?: Date } } = {}) {
  const slot = await db.timetableSlot.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      weekday: WEEKDAY_NAMES[new Date().getDay()],
      startTime: new Date(Date.UTC(1970, 0, 1, 18, 0)),
      endTime: new Date(Date.UTC(1970, 0, 1, 19, 0)),
      breakStart: opts.breakStart ?? null,
      breakEnd: opts.breakEnd ?? null,
      title: slotTitle,
      activities: ['BJJ'],
      styles: [{ disciplineId: s.disciplineId, classType: null }],
      capacity: opts.capacity ?? null,
      status: 'ON',
    },
  });
  const next = new Date();
  next.setDate(next.getDate() + 7);
  const occurrenceDate = new Date(Date.UTC(next.getFullYear(), next.getMonth(), next.getDate()));
  const created = await db.class.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      timetableSlotId: slot.id,
      title: slotTitle,
      activities: ['BJJ'],
      styles: [{ disciplineId: s.disciplineId, classType: null }],
      capacity: opts.capacity ?? null,
      ...(opts.cls ?? {
        occurrenceDate,
        startDate: new Date(occurrenceDate.getTime() + 18 * 3_600_000),
        endDate: new Date(occurrenceDate.getTime() + 19 * 3_600_000),
      }),
    },
  });
  return { slotId: slot.id, classId: created.id };
}

async function bookDirectly(classId: string, studentId: string) {
  const membership = await db.membership.findFirstOrThrow({ where: { studentId, schoolId: s.schoolId } });
  await db.booking.create({ data: { id: randomUUID(), studentId, classId, schoolId: s.schoolId, sourceMembershipId: membership.id } });
}

async function openEdit(page: import('@playwright/test').Page) {
  await page.goto('/timetable');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: `Actions for ${slotTitle} on ${nextKey}` }).click();
  await page.getByRole('menuitem', { name: 'Edit slot' }).click();
  return page.getByRole('dialog', { name: 'Edit timetable slot' });
}

test('Archive asks first: Cancel leaves the slot, confirming archives it', async ({ page }) => {
  const { slotId } = await slotWithClass();
  await signIn(page, s.ownerToken);
  await page.goto('/timetable');
  await page.getByRole('button', { name: 'Next' }).click();

  const openArchive = async () => {
    await page.getByRole('button', { name: `Actions for ${slotTitle} on ${nextKey}` }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
  };
  await openArchive();
  const dialog = page.getByRole('dialog', { name: `Archive ${slotTitle}?` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await db.timetableSlot.findUniqueOrThrow({ where: { id: slotId } })).archivedAt).toBeNull();

  await openArchive();
  await dialog.getByRole('button', { name: 'Archive' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await db.timetableSlot.findUniqueOrThrow({ where: { id: slotId } })).archivedAt).not.toBeNull();
});

test('clearing both break times removes the break', async ({ page }) => {
  const { slotId } = await slotWithClass({
    breakStart: new Date(Date.UTC(1970, 0, 1, 18, 20)),
    breakEnd: new Date(Date.UTC(1970, 0, 1, 18, 30)),
  });
  await signIn(page, s.ownerToken);
  const form = await openEdit(page);
  await form.getByLabel('Break start').fill('');
  await form.getByLabel('Break end').fill('');
  await form.getByRole('button', { name: 'Save' }).click();

  await expect(form).toHaveCount(0);
  const slot = await db.timetableSlot.findUniqueOrThrow({ where: { id: slotId } });
  expect(slot.breakStart).toBeNull();
  expect(slot.breakEnd).toBeNull();
});

test('a break with only one end is refused in the form', async ({ page }) => {
  await slotWithClass();
  await signIn(page, s.ownerToken);
  const form = await openEdit(page);
  await form.getByLabel('Break start').fill('18:20');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('Give the break both a start and an end time, or neither.')).toBeVisible();
});

test('a booking-rule change asks Apply or Keep for booked classes, and Keep leaves them as booked', async ({ page }) => {
  const { slotId, classId } = await slotWithClass();
  await bookDirectly(classId, s.student.id);
  await signIn(page, s.ownerToken);
  const form = await openEdit(page);
  await form.getByLabel('Requires signed waiver/terms to book').check();
  await form.getByRole('button', { name: 'Save' }).click();

  const choice = page.getByRole('dialog', { name: 'Some upcoming classes have bookings' });
  await expect(choice).toBeVisible();
  await expect(choice.getByLabel(/Apply to booked classes too/)).toBeChecked();
  await expect(choice.getByLabel(/Cancel them/)).toHaveCount(0);
  await choice.getByLabel(/Keep the old rules for booked classes/).check();
  await choice.getByRole('button', { name: 'Save change' }).click();

  await expect(choice).toHaveCount(0);
  expect((await db.timetableSlot.findUniqueOrThrow({ where: { id: slotId } })).termsWaiverRequired).toBe(true);
  expect((await db.class.findUniqueOrThrow({ where: { id: classId } })).termsWaiverRequired).toBe(false);
  expect(await db.booking.count({ where: { classId, status: 'UPCOMING' } })).toBe(1);
});

test('a capacity cut below seats booked only asks to confirm, and the fuller class keeps its size', async ({ page }) => {
  const { slotId, classId } = await slotWithClass({ capacity: 5 });
  await bookDirectly(classId, s.student.id);
  await bookDirectly(classId, s.newStudent.id);
  await signIn(page, s.ownerToken);
  const form = await openEdit(page);
  await form.getByLabel('Capacity').fill('1');
  await form.getByRole('button', { name: 'Save' }).click();

  const confirm = page.getByRole('dialog', { name: 'Some upcoming classes are fuller than the new capacity' });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText(/already has 2 students booked/)).toBeVisible();
  await expect(confirm.getByRole('radio')).toHaveCount(0);
  await confirm.getByRole('button', { name: 'Save change' }).click();

  await expect(confirm).toHaveCount(0);
  expect((await db.timetableSlot.findUniqueOrThrow({ where: { id: slotId } })).capacity).toBe(1);
  expect((await db.class.findUniqueOrThrow({ where: { id: classId } })).capacity).toBe(5);
  expect(await db.booking.count({ where: { classId, status: 'UPCOMING' } })).toBe(2);
});

test('more than 20 slots all show on the timetable', async ({ page }) => {
  const weekday = WEEKDAY_NAMES[new Date().getDay()];
  const now = new Date();
  const occurrenceDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  for (let i = 0; i < 25; i++) {
    const title = `Many Slot ${String(i + 1).padStart(2, '0')}`;
    const slot = await db.timetableSlot.create({
      data: {
        id: randomUUID(),
        schoolId: s.schoolId,
        weekday,
        startTime: new Date(Date.UTC(1970, 0, 1, 6, i)),
        endTime: new Date(Date.UTC(1970, 0, 1, 7, i)),
        title,
        activities: ['BJJ'],
        styles: [{ disciplineId: s.disciplineId, classType: null }],
        status: 'ON',
      },
    });
    // The calendar shows each slot's real Class (Decision 353); Edit slot needs the slot itself.
    await db.class.create({
      data: {
        id: randomUUID(),
        schoolId: s.schoolId,
        timetableSlotId: slot.id,
        occurrenceDate,
        title,
        activities: ['BJJ'],
        styles: [{ disciplineId: s.disciplineId, classType: null }],
        startDate: new Date(occurrenceDate.getTime() + (6 * 60 + i) * 60_000),
        endDate: new Date(occurrenceDate.getTime() + (7 * 60 + i) * 60_000),
      },
    });
  }
  await signIn(page, s.ownerToken);
  await page.goto('/timetable');
  await page.getByRole('button', { name: `Actions for Many Slot 25 on ${todayKey}` }).click();
  await expect(page.getByRole('menuitem', { name: 'Edit slot' })).toBeVisible();
  await expect(page.getByRole('button', { name: `Actions for Many Slot 01 on ${todayKey}` })).toBeVisible();
});

test('a cancelled class stays on the calendar, marked Cancelled, with no Book', async ({ page }) => {
  await slotWithClass({
    cls: {
      ...laterToday(),
      archivedAt: new Date(),
      cancelledAt: new Date(),
    },
  });
  await signIn(page, s.ownerToken);
  await page.goto('/timetable');
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Actions for ${slotTitle} on ${todayKey}` }).click();
  await expect(page.getByRole('menuitem', { name: 'Open class' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Book' })).toHaveCount(0);
});

test('the calendar shows a one-off class with its seats, and booking it from there works', async ({ page }) => {
  const start = new Date(Date.now() + 10 * 60_000);
  const oneOff = await db.class.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      title: 'One-off Seminar',
      activities: ['BJJ'],
      styles: [{ disciplineId: s.disciplineId, classType: null }],
      startDate: start,
      endDate: new Date(start.getTime() + 3_600_000),
      capacity: 4,
      // Covered by the Students' general membership.
      membershipInclusion: true,
    },
  });
  await bookDirectly(oneOff.id, s.newStudent.id);
  const key = dateKey(start);
  await signIn(page, s.ownerToken);
  await page.goto('/timetable');
  await expect(page.getByText('1 of 4 booked')).toBeVisible();
  await page.getByRole('button', { name: `Actions for One-off Seminar on ${key}` }).click();
  await page.getByRole('menuitem', { name: 'Book' }).click();
  const dialog = page.getByRole('dialog', { name: 'Book — One-off Seminar' });
  await dialog.getByLabel('Student').selectOption({ label: 'Sam Lee' });
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('2 of 4 booked')).toBeVisible();
});

test('the class details show its break (Decision 353, Q6)', async ({ page }) => {
  const { classId } = await slotWithClass();
  const cls = await db.class.findUniqueOrThrow({ where: { id: classId } });
  await db.class.update({
    where: { id: classId },
    data: { breakStartAt: new Date(cls.startDate.getTime() + 20 * 60_000), breakEndAt: new Date(cls.startDate.getTime() + 30 * 60_000) },
  });
  await signIn(page, s.ownerToken);
  await page.goto(`/classes/${classId}`);
  await expect(page.getByText(/Break /)).toBeVisible();
});

test('Branch Staff see their own branch on a read-only timetable and book walk-ins (Decision 353, Q4)', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const south = await addBranch(s, 'South');
  const start = new Date(Date.now() + 10 * 60_000);
  const oneOff = (title: string, branchId: string | null) =>
    db.class.create({
      data: {
        id: randomUUID(),
        schoolId: s.schoolId,
        branchId,
        title,
        activities: ['BJJ'],
        styles: [{ disciplineId: s.disciplineId, classType: null }],
        startDate: start,
        endDate: new Date(start.getTime() + 3_600_000),
        capacity: 4,
        membershipInclusion: true,
      },
    });
  await oneOff('North Fundamentals', north.id);
  await oneOff('South Fundamentals', south.id);
  await oneOff('Open Mat', null);
  // Branch Staff pick from their own branch's students (Decision 139's rule).
  await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, branchId: north.id } });
  const staff = await addPerson('Nia', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  const key = dateKey(start);

  await signIn(page, staff.token);
  await page.goto('/coach');
  await page.getByRole('navigation').getByRole('link', { name: 'Timetable' }).click();
  await expect(page.getByRole('heading', { name: 'Timetable' })).toBeVisible();
  await expect(page.getByText('North Fundamentals')).toBeVisible();
  await expect(page.getByText('Open Mat')).toBeVisible();
  await expect(page.getByText('South Fundamentals')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add slot' })).toHaveCount(0);
  await expect(page.getByText('Show archived')).toHaveCount(0);

  await page.getByRole('button', { name: `Actions for North Fundamentals on ${key}` }).click();
  await expect(page.getByRole('menuitem', { name: 'Open class' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Edit slot' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Book' }).click();
  const dialog = page.getByRole('dialog', { name: 'Book — North Fundamentals' });
  await expect(dialog.getByLabel('Student').locator('option')).toHaveText(['Select a Student…', 'Sam Lee']);
  await dialog.getByLabel('Student').selectOption({ label: 'Sam Lee' });
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('1 of 4 booked')).toBeVisible();
});

test('an Instructor still has no Timetable screen', async ({ page }) => {
  const coach = await addPerson('Ian', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await signIn(page, coach.token);
  await page.goto('/coach');
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Timetable' })).toHaveCount(0);
  await page.goto('/timetable');
  await expect(page).not.toHaveURL(/\/timetable$/);
});
