import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Classes review second batch (Decision 345), in the browser against the real
 * API: the "Included in membership" switch shows on one-off Classes only, with
 * what it means (C1), and moving a booked Class into the past is refused with
 * the portal's own wording (C5).
 */
let s: GradingSchool;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(Date.now() + ms);

function mkClass(data: Record<string, unknown>) {
  return db.class.create({
    data: { id: randomUUID(), schoolId: s.schoolId, title: 'Fixture', activities: ['BJJ'], styles: [{ disciplineId: s.disciplineId, classType: null }], startDate: at(DAY), endDate: at(DAY + HOUR), ...data },
  });
}

async function openEdit(page: import('@playwright/test').Page, title: string) {
  await page.goto('/classes');
  await page.getByRole('button', { name: `Actions for ${title}` }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  return page.getByRole('dialog', { name: 'Edit class' });
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
  await db.timetableSlot.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

test('"Included in membership" shows on a one-off Class with its meaning, not on a Timetable Class', async ({ page }) => {
  await mkClass({ title: 'Seminar' });
  const slot = await db.timetableSlot.create({
    data: { id: randomUUID(), schoolId: s.schoolId, title: 'Weekly', weekday: 'MONDAY', startTime: new Date('1970-01-01T18:00:00Z'), endTime: new Date('1970-01-01T19:00:00Z'), activities: ['BJJ'], styles: [{ disciplineId: s.disciplineId, classType: null }] },
  });
  await mkClass({ title: 'Weekly BJJ', timetableSlotId: slot.id, occurrenceDate: at(DAY) });
  await signIn(page, s.ownerToken);

  let dialog = await openEdit(page, 'Seminar');
  await expect(dialog.getByLabel('Included in general membership access (no separate ticket required)')).toBeVisible();
  await expect(dialog.getByText(/Off: students need a ticket made for this class/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  dialog = await openEdit(page, 'Weekly BJJ');
  await expect(dialog.getByLabel('Title')).toBeVisible();
  await expect(dialog.getByLabel('Included in general membership access (no separate ticket required)')).toHaveCount(0);
});

test('moving a booked Class into the past is refused', async ({ page }) => {
  const cls = await mkClass({ title: 'Booked class', membershipInclusion: true });
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
  const student = await addPerson('Stu', 'Booked', [{ role: 'STUDENT', schoolId: s.schoolId }]);
  const m = await db.membership.create({ data: { id: randomUUID(), studentId: student.id, schoolId: s.schoolId, membershipPlanId: plan.id, frequency: 'RECURRING' } });
  await db.booking.create({ data: { id: randomUUID(), studentId: student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: m.id } });
  await signIn(page, s.ownerToken);

  const dialog = await openEdit(page, 'Booked class');
  await dialog.getByLabel('Start date').fill('2020-01-10T10:00');
  await dialog.getByLabel('End date').fill('2020-01-10T11:00');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText("Students are booked or waiting for this class, so it can only move to a time that hasn't passed yet.")).toBeVisible();
  expect((await db.class.findUniqueOrThrow({ where: { id: cls.id } })).startDate.getTime()).toBe(cls.startDate.getTime());
});
