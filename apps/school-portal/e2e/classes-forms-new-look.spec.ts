import { randomUUID } from 'crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';
import { pickOption } from './team-helpers';

/**
 * The Classes / Schedule dialogs in the new look (Decisions 453, 460): the
 * class form, the timetable slot form, Book a student, Booked classes,
 * Closures, Open mat and Scan a QR code, plus the class page itself
 * (/classes/:id) with its three dialogs. No browser drop-down is left, the
 * buttons sit in the dialog's band with Cancel first, a drop-down pick counts
 * as an edit (an outside click keeps the dialog), and everything fits a
 * phone. Look only: the booking, capacity, waitlist and timetable rules are
 * still covered by class-page-bookings, booking-rules, timetable-booking,
 * timetable-review-fixes, classes-review and front-desk.
 */
let s: GradingSchool;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEKDAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;
const slotTitle = 'New Look Fundamentals';

const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function subscribe(studentId: string) {
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: `Unlimited ${randomUUID().slice(0, 4)}`, price: 5000 } });
  return db.membership.create({ data: { id: randomUUID(), studentId, membershipPlanId: plan.id, schoolId: s.schoolId, status: 'ACTIVE', frequency: 'RECURRING' } });
}

function oneOffClass(data: Record<string, unknown> = {}) {
  return db.class.create({
    data: { id: randomUUID(), schoolId: s.schoolId, title: 'Open mat', activities: ['BJJ'], membershipInclusion: true, startDate: new Date(Date.now() + DAY), endDate: new Date(Date.now() + DAY + HOUR), ...data },
  });
}

/** A weekly slot on today's weekday with one booked class a week ahead. */
async function bookedSlot() {
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
      status: 'ON',
    },
  });
  const next = new Date();
  next.setDate(next.getDate() + 7);
  const occurrenceDate = new Date(Date.UTC(next.getFullYear(), next.getMonth(), next.getDate()));
  const cls = await db.class.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      timetableSlotId: slot.id,
      title: slotTitle,
      activities: ['BJJ'],
      styles: [{ disciplineId: s.disciplineId, classType: null }],
      membershipInclusion: true,
      occurrenceDate,
      startDate: new Date(occurrenceDate.getTime() + 18 * HOUR),
      endDate: new Date(occurrenceDate.getTime() + 19 * HOUR),
    },
  });
  const m = await subscribe(s.student.id);
  await db.booking.create({ data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: m.id } });
  return { slot, cls, next };
}

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.waitlistEntry.deleteMany({ where });
  await db.booking.deleteMany({ where });
  await db.class.deleteMany({ where });
  await db.timetableSlot.deleteMany({ where });
  await db.closure.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

/** A dialog in the new look: no browser drop-down, and its buttons in the band at its foot, Cancel first. */
async function expectNewLook(dialog: Locator, buttons: string[]) {
  await expect(dialog.locator('select')).toHaveCount(0);
  await expect(dialog.locator('.ultm8-modal__actions').getByRole('button')).toHaveText(buttons);
  // The band is the dialog's last row: in a form it is the form's last child, so Enter submits.
  await expect(dialog.locator('.ultm8-modal__actions')).toHaveCount(1);
}

/** Nothing scrolls the page sideways. */
async function expectNoSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test('the class form: new-look drop-downs, the band with Cancel first, a pick counts as an edit, Enter saves', async ({ page }) => {
  await page.goto('/classes');
  await page.getByRole('button', { name: 'Add class' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add class' });
  await expectNewLook(dialog, ['Cancel', 'Save']);
  await expect(dialog.locator('form > .ultm8-modal__actions:last-child')).toHaveCount(1);
  // Style, Branch, Instructor and Who can book are the new look's own drop-downs.
  for (const name of ['Style', 'Branch', 'Instructor', 'Who can book']) {
    await expect(dialog.getByRole('combobox', { name, exact: true })).toBeVisible();
  }
  // A pick counts as an edit: an outside click no longer closes the dialog.
  await pickOption(dialog, 'Who can book', 'Women only');
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Title').fill('Look Seminar');
  await pickOption(dialog, 'Style', 'BJJ');
  const start = new Date(Date.now() + 3 * DAY);
  const day = dateKey(start);
  await dialog.getByLabel('Start date').fill(`${day}T10:00`);
  await dialog.getByLabel('End date').fill(`${day}T11:00`);
  await dialog.getByLabel('Title').press('Enter');
  await expect(dialog).toHaveCount(0);
  const cls = await db.class.findFirstOrThrow({ where: { schoolId: s.schoolId, title: 'Look Seminar' } });
  expect(cls.audience).toBe('WOMEN');
  expect(cls.styles).toEqual([{ disciplineId: s.disciplineId, classType: null }]);
});

test('the slot form and the booked-classes choice: drop-downs, option cards and the band', async ({ page }) => {
  const { next } = await bookedSlot();
  await page.goto('/timetable');
  await page.getByRole('button', { name: 'Add slot' }).click();
  const add = page.getByRole('dialog', { name: 'Add timetable slot' });
  await expectNewLook(add, ['Cancel', 'Save']);
  for (const name of ['Style', 'Weekday', 'Status', 'Branch', 'Instructor', 'Who can book']) {
    await expect(add.getByRole('combobox', { name, exact: true })).toBeVisible();
  }
  await pickOption(add, 'Weekday', 'Friday');
  await page.mouse.click(5, 5);
  await expect(add).toBeVisible();
  await add.getByRole('button', { name: 'Cancel' }).click();
  await expect(add).toHaveCount(0);

  // Editing the slot's time asks what happens to the booked class: option cards, still radios.
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: `Actions for ${slotTitle} on ${dateKey(next)}` }).click();
  await page.getByRole('menuitem', { name: 'Edit slot' }).click();
  const form = page.getByRole('dialog', { name: 'Edit timetable slot' });
  await form.getByLabel('Start time').fill('17:00');
  await form.getByRole('button', { name: 'Save' }).click();
  const choice = page.getByRole('dialog', { name: 'Some upcoming classes have bookings' });
  await expectNewLook(choice, ['Cancel', 'Save change']);
  await expect(choice.locator('.u8cf-choice')).toHaveCount(3);
  await expect(choice.getByRole('radio', { name: /Move them/ })).toBeChecked();
  await choice.getByRole('radio', { name: /Keep them/ }).check();
  await expect(choice.getByRole('radio', { name: /Keep them/ })).toBeChecked();
  await choice.getByRole('button', { name: 'Cancel' }).click();
  await expect(choice).toHaveCount(0);
});

test('Book a student and Closures: the student drop-down, the details card and the band', async ({ page }) => {
  const now = new Date();
  const start = new Date(Math.min(now.getTime() + 2 * HOUR, new Date(now).setHours(23, 50, 0, 0)));
  await oneOffClass({ title: 'Desk Class', startDate: start, endDate: new Date(start.getTime() + HOUR) });
  await subscribe(s.student.id);
  await page.goto('/timetable');
  await page.getByRole('button', { name: `Actions for Desk Class on ${dateKey(start)}` }).click();
  await page.getByRole('menuitem', { name: 'Book' }).click();
  const book = page.getByRole('dialog', { name: 'Book — Desk Class' });
  await expectNewLook(book, ['Cancel', 'Confirm']);
  await expect(book.locator('.u8cf-facts')).toContainText('Desk Class');
  await pickOption(book, 'Student', s.student.name);
  await page.mouse.click(5, 5);
  await expect(book).toBeVisible();
  await book.getByRole('button', { name: 'Cancel' }).click();
  await expect(book).toHaveCount(0);

  await page.getByRole('button', { name: 'Closures' }).click();
  const closures = page.getByRole('dialog', { name: 'Closures' });
  await expectNewLook(closures, ['Done', 'Add closure']);
  await expect(closures.getByRole('combobox', { name: 'Where', exact: true })).toBeVisible();
  // Confirming swaps the band's buttons: Back first, then the action.
  await closures.getByLabel('From').fill(dateKey(new Date(Date.now() + 30 * DAY)));
  await closures.getByLabel('Reason').fill('Holiday');
  await closures.getByRole('button', { name: 'Add closure' }).click();
  await expect(closures.locator('.ultm8-modal__actions').getByRole('button')).toHaveText(['Back', 'Close and cancel classes']);
  await closures.getByRole('button', { name: 'Back' }).click();
  await expect(closures.locator('.ultm8-modal__actions').getByRole('button')).toHaveText(['Done', 'Add closure']);
});

test('Open mat on the Check-in page: three drop-downs and the band', async ({ page }) => {
  await page.goto('/check-in');
  await page.getByRole('button', { name: '+ Open mat session' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start an open mat' });
  await expectNewLook(dialog, ['Cancel', 'Start open mat']);
  await expect(dialog.locator('form > .ultm8-modal__actions:last-child')).toHaveCount(1);
  await pickOption(dialog, 'Length', '45 min');
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Length', exact: true }).locator('[data-shown="true"]')).toHaveText('45 min');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('the class page: new-look header, cards and tags, and its three dialogs with the band', async ({ page }) => {
  const cls = await oneOffClass();
  const m = await subscribe(s.student.id);
  await db.booking.create({ data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: m.id } });
  await subscribe(s.newStudent.id);
  await page.goto(`/classes/${cls.id}`);

  const main = page.locator('.u8n-content');
  await expect(main.locator('.u8n-page-header')).toBeVisible();
  await expect(main.getByRole('link', { name: 'Classes' })).toHaveAttribute('href', '/classes');
  await expect(main.locator('.ultm8-page-header, .ultm8-card, .ultm8-badge, select')).toHaveCount(0);
  await expect(page.getByTestId('class-bookings').getByText('Upcoming', { exact: true })).toHaveClass(/u8s-tag--mint/);

  await page.getByRole('button', { name: 'Add student' }).click();
  const add = page.getByRole('dialog', { name: 'Add a student to this class' });
  await expectNewLook(add, ['Cancel', 'Book']);
  await pickOption(add, 'Student', s.newStudent.name);
  await page.mouse.click(5, 5);
  await expect(add).toBeVisible();
  await add.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: `Cancel ${s.student.name}'s booking` }).click();
  const cancelBooking = page.getByRole('dialog', { name: `Cancel ${s.student.name}'s booking?` });
  await expectNewLook(cancelBooking, ['Keep the booking', 'Cancel booking']);
  await cancelBooking.getByRole('button', { name: 'Keep the booking' }).click();

  await page.getByRole('button', { name: 'Cancel class' }).click();
  const cancelClass = page.getByRole('dialog', { name: 'Cancel this class?' });
  await expectNewLook(cancelClass, ['Keep the class', 'Cancel class']);
  await cancelClass.getByRole('button', { name: 'Keep the class' }).click();
  await expect(cancelClass).toHaveCount(0);
  expect((await db.class.findUniqueOrThrow({ where: { id: cls.id } })).cancelledAt).toBeNull();
});

test('Scan a QR code has the band with Cancel', async ({ page }) => {
  const cls = await oneOffClass({ startDate: new Date(Date.now() - 10 * 60_000), endDate: new Date(Date.now() + HOUR) });
  const m = await subscribe(s.student.id);
  await db.booking.create({ data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: m.id } });
  await page.goto(`/classes/${cls.id}/roll-call`);
  await page.getByRole('button', { name: 'Scan', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: "Scan Student's check-in code" });
  await expectNewLook(dialog, ['Cancel']);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the class page turns its rows into cards and the dialogs fit, nothing scrolls sideways', async ({ page }) => {
    const cls = await oneOffClass();
    const m = await subscribe(s.student.id);
    await db.booking.create({ data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: m.id } });
    await page.goto(`/classes/${cls.id}`);
    await expect(page.getByTestId('class-bookings')).toHaveAttribute('data-layout', 'cards');
    await expect(page.getByRole('cell', { name: s.student.name, exact: true })).toBeVisible();
    await expectNoSidewaysScroll(page);

    await page.getByRole('button', { name: 'Add student' }).click();
    const add = page.getByRole('dialog', { name: 'Add a student to this class' });
    await expect(add.locator('.ultm8-modal__actions')).toBeInViewport();
    await expectNoSidewaysScroll(page);
    await add.getByRole('button', { name: 'Cancel' }).click();

    await page.goto('/classes');
    await page.getByRole('button', { name: 'Add class' }).click();
    const form = page.getByRole('dialog', { name: 'Add class' });
    await expect(form.locator('.ultm8-modal__actions')).toBeInViewport();
    await expectNoSidewaysScroll(page);
    const box = (await form.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(390);
  });
});
