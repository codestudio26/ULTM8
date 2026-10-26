import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

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
  await db.membershipPlan.deleteMany({ where: { id: planId } });
});

test.afterAll(async () => {
  await cleanup();
});

/** A slot on today's weekday (so the Week view shows it on today), with one
 * class a week from today unless `cls` says otherwise. */
async function slotWithClass(opts: { capacity?: number; breakStart?: Date; breakEnd?: Date; cls?: { occurrenceDate: Date; startDate: Date; endDate: Date; archivedAt?: Date } } = {}) {
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
  await page.getByRole('button', { name: `Actions for ${slotTitle} on ${todayKey}` }).click();
  await page.getByRole('menuitem', { name: 'Edit slot' }).click();
  return page.getByRole('dialog', { name: 'Edit timetable slot' });
}

test('Archive asks first: Cancel leaves the slot, confirming archives it', async ({ page }) => {
  const { slotId } = await slotWithClass();
  await signIn(page, s.ownerToken);
  await page.goto('/timetable');

  const openArchive = async () => {
    await page.getByRole('button', { name: `Actions for ${slotTitle} on ${todayKey}` }).click();
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
  await db.timetableSlot.createMany({
    data: Array.from({ length: 25 }, (_, i) => ({
      id: randomUUID(),
      schoolId: s.schoolId,
      weekday,
      startTime: new Date(Date.UTC(1970, 0, 1, 6, i)),
      endTime: new Date(Date.UTC(1970, 0, 1, 7, i)),
      title: `Many Slot ${String(i + 1).padStart(2, '0')}`,
      activities: ['BJJ'],
      styles: [{ disciplineId: s.disciplineId, classType: null }],
      status: 'ON' as const,
    })),
  });
  await signIn(page, s.ownerToken);
  await page.goto('/timetable');
  await expect(page.getByRole('button', { name: `Actions for Many Slot 25 on ${todayKey}` })).toBeVisible();
  await expect(page.getByRole('button', { name: `Actions for Many Slot 01 on ${todayKey}` })).toBeVisible();
});

test('a cancelled class says it is cancelled instead of offering Confirm', async ({ page }) => {
  const now = new Date();
  const occurrenceDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  await slotWithClass({
    cls: {
      occurrenceDate,
      startDate: new Date(now.getTime() + 2 * 3_600_000),
      endDate: new Date(now.getTime() + 3 * 3_600_000),
      archivedAt: new Date(),
    },
  });
  await signIn(page, s.ownerToken);
  await page.goto('/timetable');
  await page.getByRole('button', { name: `Actions for ${slotTitle} on ${todayKey}` }).click();
  await page.getByRole('menuitem', { name: 'Book' }).click();

  const dialog = page.getByRole('dialog', { name: `Book — ${slotTitle}` });
  await expect(dialog.getByText('This class has been cancelled, so it can no longer be booked.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
});
