import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The Class page's Add student and Cancel booking (Classes review follow-up,
 * Decision 349): staff book a student in from the class itself, are offered the
 * waitlist when it's full, and cancel one booking. Both go through the same API
 * a student uses, so every booking and cancellation rule still applies.
 */
let s: GradingSchool;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(Date.now() + ms);

async function subscribe(studentId: string) {
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: `Unlimited ${randomUUID().slice(0, 4)}`, price: 5000 } });
  return db.membership.create({ data: { id: randomUUID(), studentId, membershipPlanId: plan.id, schoolId: s.schoolId, status: 'ACTIVE', frequency: 'RECURRING' } });
}

function mkClass(data: Record<string, unknown> = {}) {
  return db.class.create({
    data: { id: randomUUID(), schoolId: s.schoolId, title: 'Open mat', activities: ['BJJ'], membershipInclusion: true, startDate: at(DAY), endDate: at(DAY + HOUR), ...data },
  });
}

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.waitlistEntry.deleteMany({ where });
  await db.booking.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
  await db.class.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

test('staff add a student to a class, then cancel their booking', async ({ page }) => {
  const cls = await mkClass();
  await subscribe(s.student.id);
  await signIn(page, s.ownerToken);
  await page.goto(`/classes/${cls.id}`);

  await page.getByRole('button', { name: 'Add student' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a student to this class' });
  await dialog.getByLabel('Student').selectOption({ label: s.student.name });
  await dialog.getByRole('button', { name: 'Book' }).click();
  await expect(page.getByText(`${s.student.name} is booked into this class.`)).toBeVisible();
  await expect(page.getByRole('cell', { name: s.student.name, exact: true })).toBeVisible();
  const booking = await db.booking.findFirstOrThrow({ where: { classId: cls.id, studentId: s.student.id } });
  expect(booking.status).toBe('UPCOMING');

  // Already booked: not offered again.
  await page.getByRole('button', { name: 'Add student' }).click();
  await expect(page.getByRole('dialog').getByRole('option', { name: s.student.name })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.getByRole('button', { name: `Cancel ${s.student.name}'s booking` }).click();
  const confirm = page.getByRole('dialog', { name: `Cancel ${s.student.name}'s booking?` });
  await expect(confirm.getByText(/cancellation settings decide/)).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel booking' }).click();
  await expect(page.getByText(`${s.student.name}'s booking is cancelled.`)).toBeVisible();
  expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CANCELLED');
  await expect(page.getByRole('button', { name: `Cancel ${s.student.name}'s booking` })).toHaveCount(0);
});

test('a full class offers the waitlist instead', async ({ page }) => {
  const cls = await mkClass({ capacity: 1 });
  const m = await subscribe(s.student.id);
  await db.booking.create({ data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: m.id } });
  await subscribe(s.newStudent.id);
  await signIn(page, s.ownerToken);
  await page.goto(`/classes/${cls.id}`);

  await page.getByRole('button', { name: 'Add student' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a student to this class' });
  await dialog.getByLabel('Student').selectOption({ label: s.newStudent.name });
  await dialog.getByRole('button', { name: 'Book' }).click();
  await dialog.getByRole('button', { name: 'Add to waitlist' }).click();
  await expect(page.getByText(`${s.newStudent.name} is number 1 on the waitlist.`)).toBeVisible();
  expect(await db.waitlistEntry.count({ where: { classId: cls.id, studentId: s.newStudent.id } })).toBe(1);
});

test('an ended class has no Add student or Cancel booking', async ({ page }) => {
  const cls = await mkClass({ startDate: at(-2 * HOUR), endDate: at(-HOUR) });
  const m = await subscribe(s.student.id);
  await db.booking.create({ data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: m.id } });
  await signIn(page, s.ownerToken);
  await page.goto(`/classes/${cls.id}`);

  await expect(page.getByRole('cell', { name: s.student.name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add student' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Cancel .*'s booking/ })).toHaveCount(0);
});
