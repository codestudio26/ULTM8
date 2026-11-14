import { randomUUID } from 'crypto';
import { expect, test, type Locator } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 462 items 6, 7, 8 and 26, by keyboard:
 * 6. In a searchable picker, Enter picks the first match and never submits the form.
 * 7. A new-look drop-down jumps to an option when its first letter is typed;
 *    the same letter again moves to the next, and a word typed quickly
 *    matches the start of a name.
 * 8. The Class page's "Add a student" and the Timetable's "Book a student"
 *    pick the student by typing (the searchable picker).
 * 26. School → Charges and tax: the tax country is searchable.
 * The values sent to the API are the same as before (ids, country and region codes).
 */
let s: GradingSchool;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The text of the option a drop-down's keyboard highlight is on. */
async function highlighted(field: Locator) {
  const id = await field.getAttribute('aria-activedescendant');
  expect(id).toBeTruthy();
  return field.page().locator(`[id="${id}"]`).innerText();
}

async function subscribe(studentId: string) {
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: `Unlimited ${randomUUID().slice(0, 4)}`, price: 5000 } });
  return db.membership.create({ data: { id: randomUUID(), studentId, membershipPlanId: plan.id, schoolId: s.schoolId, status: 'ACTIVE', frequency: 'RECURRING' } });
}

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
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

test('item 6: Enter in the Country picker picks the first match and does not save the form', async ({ page }) => {
  await page.goto(`/students/${s.newStudent.id}/edit`);
  const country = page.getByRole('combobox', { name: 'Country', exact: true });
  await country.click();
  await country.pressSequentially('zeal');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText(['New Zealand']);
  await country.press('Enter');
  await expect(country).toHaveValue('New Zealand');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  // Closed, Enter still doesn't send the form.
  await country.press('Enter');
  await page.waitForTimeout(300);
  await expect(page.getByText('Profile saved.')).toHaveCount(0);
  expect((await db.user.findUniqueOrThrow({ where: { id: s.newStudent.id } })).addressCountry).toBeNull();
});

test('item 7: typing a letter in a drop-down jumps to the next option starting with it, by keyboard only', async ({ page }) => {
  await page.goto(`/students/${s.newStudent.id}/edit`);
  const country = page.getByRole('combobox', { name: 'Country', exact: true });
  await country.click();
  await country.pressSequentially('united states');
  await page.getByRole('listbox').getByRole('option', { name: 'United States', exact: true }).click();

  // Tab from Town/City onto the State drop-down, then type.
  await page.getByLabel('City', { exact: true }).fill('Trenton');
  await page.getByLabel('City', { exact: true }).press('Tab');
  const state = page.getByRole('combobox', { name: 'State', exact: true });
  await expect(state).toBeFocused();
  await page.keyboard.press('n');
  await expect(page.getByRole('listbox', { name: 'State' })).toBeVisible();
  expect(await highlighted(state)).toBe('Nebraska');
  await page.keyboard.press('n');
  expect(await highlighted(state)).toBe('Nevada');
  await page.keyboard.press('n');
  expect(await highlighted(state)).toBe('New Hampshire');
  // After a pause, a word typed quickly matches the start of a name.
  await page.waitForTimeout(700);
  await page.keyboard.type('new j');
  expect(await highlighted(state)).toBe('New Jersey');
  await page.keyboard.press('Enter');
  await expect(state.locator('[data-shown="true"]')).toHaveText('New Jersey');

  // Closed, a letter opens the list on its first match; Escape keeps the value.
  await page.waitForTimeout(700);
  await page.keyboard.press('t');
  expect(await highlighted(state)).toBe('Tennessee');
  await page.keyboard.press('Escape');
  await expect(state.locator('[data-shown="true"]')).toHaveText('New Jersey');

  await page.getByLabel('Address line 1').fill('1 State St');
  await page.getByLabel('ZIP code').fill('08608');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  const user = await db.user.findUniqueOrThrow({ where: { id: s.newStudent.id } });
  expect(user.addressCountry).toBe('US');
  expect(user.addressRegion).toBe('NJ');
});

test('item 8: Add a student on the Class page is searchable, and Enter picks the first match', async ({ page }) => {
  const cls = await db.class.create({
    data: { id: randomUUID(), schoolId: s.schoolId, title: 'Open mat', activities: ['BJJ'], membershipInclusion: true, startDate: new Date(Date.now() + DAY), endDate: new Date(Date.now() + DAY + HOUR) },
  });
  await subscribe(s.newStudent.id);
  await page.goto(`/classes/${cls.id}`);
  await page.getByRole('button', { name: 'Add student' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a student to this class' });
  const student = dialog.getByRole('combobox', { name: 'Student', exact: true });
  await student.focus();
  const options = dialog.getByRole('listbox').getByRole('option');
  await expect(options).toHaveCount(3);
  await expect(options.first()).toHaveText('Select a student…');
  await student.pressSequentially('pa');
  await expect(dialog.getByRole('listbox').getByRole('option')).toHaveText(['Nia Park']);
  await student.press('Enter');
  await expect(student).toHaveValue('Nia Park');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Book' }).click();
  await expect(page.getByText('Nia Park is booked into this class.')).toBeVisible();
  const booking = await db.booking.findFirstOrThrow({ where: { classId: cls.id } });
  expect(booking.studentId).toBe(s.newStudent.id);
});

test('item 8: Book a student on the Timetable is searchable, and Enter picks the first match', async ({ page }) => {
  const now = new Date();
  const start = new Date(Math.min(now.getTime() + 2 * HOUR, new Date(now).setHours(23, 50, 0, 0)));
  const cls = await db.class.create({
    data: { id: randomUUID(), schoolId: s.schoolId, title: 'Desk Class', activities: ['BJJ'], membershipInclusion: true, startDate: start, endDate: new Date(start.getTime() + HOUR) },
  });
  await subscribe(s.student.id);
  await page.goto('/timetable');
  await page.getByRole('button', { name: `Actions for Desk Class on ${dateKey(start)}` }).click();
  await page.getByRole('menuitem', { name: 'Book' }).click();
  const dialog = page.getByRole('dialog', { name: 'Book — Desk Class' });
  const student = dialog.getByRole('combobox', { name: 'Student', exact: true });
  await student.click();
  await student.pressSequentially('lee');
  await expect(dialog.getByRole('listbox').getByRole('option')).toHaveText(['Sam Lee']);
  await student.press('Enter');
  await expect(student).toHaveValue('Sam Lee');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog).toHaveCount(0);
  const booking = await db.booking.findFirstOrThrow({ where: { classId: cls.id } });
  expect(booking.studentId).toBe(s.student.id);
});

test('item 26: the tax country is searchable like Country, and Enter picks without saving', async ({ page }) => {
  await page.goto('/school');
  const card = page.getByTestId('charge-settings');
  const country = card.getByRole('combobox', { name: 'Country your School is in', exact: true });
  await expect(country).toHaveValue('Choose a country');
  await country.click();
  await country.pressSequentially('zeal');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText(['New Zealand']);
  // By its two-letter code too, as Country does elsewhere.
  await country.fill('gb');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText(['United Kingdom']);
  await country.press('Enter');
  await expect(country).toHaveValue('United Kingdom');
  await expect(card.getByLabel('Tax rate (%)', { exact: true })).toHaveValue('20');
  await page.waitForTimeout(300);
  await expect(card.getByText('Saved.', { exact: true })).toHaveCount(0);
  expect((await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).taxCountry).toBeNull();

  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByText('Saved.', { exact: true })).toBeVisible();
  const school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(school).toMatchObject({ taxCountry: 'GB', taxRateBasisPoints: 2000 });
});
