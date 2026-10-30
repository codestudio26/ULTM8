import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Classes review fixes (Decision 335), in the browser against the real API:
 * the Upcoming/Past views (C3), archive confirmation and no Edit on an archived
 * Class (C11), the form on the Branch's clock with normal money amounts and
 * clearable dates (C10, C11, C12), coaches reaching roll call and QR (C4, C17),
 * and a roll call that lists every booked student, not the first 20 (C2).
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

test('the list shows upcoming Classes soonest first, and past ones on their own', async ({ page }) => {
  await mkClass({ title: 'Later class', startDate: at(3 * DAY), endDate: at(3 * DAY + HOUR) });
  await mkClass({ title: 'Sooner class', startDate: at(DAY), endDate: at(DAY + HOUR) });
  await mkClass({ title: 'Last week class', startDate: at(-7 * DAY), endDate: at(-7 * DAY + HOUR) });
  await signIn(page, s.ownerToken);
  await page.goto('/classes');

  const rows = page.getByRole('row', { name: /class/ });
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Sooner class');
  await expect(rows.nth(1)).toContainText('Later class');

  await page.getByLabel('Show', { exact: true }).selectOption({ label: 'Past' });
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText('Last week class');
});

test('archiving asks first, and an archived Class offers Unarchive but not Edit', async ({ page }) => {
  const cls = await mkClass({ title: 'Archive me' });
  await signIn(page, s.ownerToken);
  await page.goto('/classes');

  await page.getByRole('button', { name: 'Actions for Archive me' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive Archive me?' });
  await expect(dialog).toBeVisible();
  expect((await db.class.findUniqueOrThrow({ where: { id: cls.id } })).archivedAt).toBeNull();
  await dialog.getByRole('button', { name: 'Archive' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await db.class.findUniqueOrThrow({ where: { id: cls.id } })).archivedAt).not.toBeNull();

  await page.getByLabel('Show archived').check();
  await page.getByRole('button', { name: 'Actions for Archive me' }).click();
  const menu = page.getByRole('menu', { name: 'Actions for Archive me' });
  await expect(menu.getByRole('menuitem', { name: 'Unarchive' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0);
});

test("the form uses the Branch's clock, normal money amounts, and dates can be cleared", async ({ page }) => {
  // Decision 414 item 6: a price needs the School's currency.
  await db.school.update({ where: { id: s.schoolId }, data: { defaultCurrency: 'GBP' } });
  const tokyo = await db.branch.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'Tokyo dojo', timezone: 'Asia/Tokyo' } });
  // 01:00 UTC is 10:00 in Tokyo, whatever the browser's own zone is.
  const cls = await mkClass({
    title: 'Tokyo class',
    branchId: tokyo.id,
    startDate: new Date('2030-01-10T01:00:00.000Z'),
    endDate: new Date('2030-01-10T02:00:00.000Z'),
    bookingEndAt: new Date('2030-01-09T23:00:00.000Z'),
  });
  await signIn(page, s.ownerToken);
  await page.goto('/classes');
  await page.getByRole('button', { name: 'Actions for Tokyo class' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit class' });

  await expect(dialog.getByLabel('Start date')).toHaveValue('2030-01-10T10:00');
  await expect(dialog.getByText('Times are in Asia/Tokyo.')).toBeVisible();
  await expect(dialog.getByLabel('Booking cutoff')).toHaveValue('2030-01-10T08:00');

  await dialog.getByLabel('Cancellation charge').fill('7.505');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Enter the cancellation charge as an amount, e.g. 5 or 7.50.')).toBeVisible();

  await dialog.getByLabel('Cancellation charge').fill('7.50');
  await dialog.getByLabel('Booking cutoff').fill('');
  await dialog.getByLabel('Start date').fill('2030-01-10T11:00');
  await dialog.getByLabel('End date').fill('2030-01-10T12:00');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  const saved = await db.class.findUniqueOrThrow({ where: { id: cls.id } });
  expect(saved.cancellationCharge).toBe(750);
  expect(saved.bookingEndAt).toBeNull();
  expect(saved.startDate.toISOString()).toBe('2030-01-10T02:00:00.000Z');
});

test('a coach opens Classes read-only and reaches roll call from the dashboard', async ({ page }) => {
  const coach = await addPerson('Cody', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await mkClass({ title: 'Coach class', instructorId: coach.id });
  await signIn(page, coach.token);
  await page.goto('/coach');

  const comingUp = page.getByRole('listitem').filter({ hasText: 'Coach class' });
  await comingUp.getByRole('link', { name: 'Roll call' }).click();
  await expect(page).toHaveURL(/\/classes\/[^/]+\/roll-call$/);
  await expect(page.getByRole('heading', { name: /Coach class/ })).toBeVisible();

  await page.getByRole('link', { name: 'Classes', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Coach class', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add class' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Actions for Coach class' }).click();
  const menu = page.getByRole('menu', { name: 'Actions for Coach class' });
  await expect(menu.getByRole('menuitem', { name: 'Roll call' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Show QR' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Archive' })).toHaveCount(0);
});

test('the roll call lists every booked student, not only the first 20', async ({ page }) => {
  const cls = await mkClass({ title: 'Big class', capacity: 30 });
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
  for (let i = 0; i < 25; i++) {
    const student = await addPerson(`Student${String(i).padStart(2, '0')}`, 'Roll', [{ role: 'STUDENT', schoolId: s.schoolId }]);
    const m = await db.membership.create({ data: { id: randomUUID(), studentId: student.id, schoolId: s.schoolId, membershipPlanId: plan.id, frequency: 'RECURRING' } });
    await db.booking.create({ data: { id: randomUUID(), studentId: student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: m.id } });
  }
  await signIn(page, s.ownerToken);
  await page.goto(`/classes/${cls.id}/roll-call`);
  await expect(page.getByRole('button', { name: 'Confirm present' })).toHaveCount(25);
  // Alphabetical, so the list reads in a predictable order.
  await expect(page.getByText(/^Student\d\d Roll$/).first()).toHaveText('Student00 Roll');
  await expect(page.getByText(/^Student\d\d Roll$/).last()).toHaveText('Student24 Roll');
});
