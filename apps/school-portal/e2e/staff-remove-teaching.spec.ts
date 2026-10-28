import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * "Remove from School" for a coach who still teaches (product owner, 28 Oct
 * 2026): the dialog shows what they teach and asks what happens to it before
 * removing them; someone who teaches nothing gets the plain confirmation.
 */
let s: GradingSchool;
const schoolIds: string[] = [];

test.beforeEach(async () => {
  s = await seedGradingSchool();
  schoolIds.push(s.schoolId);
});

test.afterAll(async () => {
  const where = { schoolId: { in: schoolIds } };
  await db.class.deleteMany({ where });
  await db.instructor.deleteMany({ where });
  await cleanup();
});

type Page = import('@playwright/test').Page;
const listCard = (page: Page) => page.locator('.ultm8-card').filter({ hasText: 'Your staff' });
const listRow = (page: Page, name: string) => listCard(page).getByRole('row').filter({ hasText: name });

/** An Instructor at this School with a profile, so the coach picker lists them. */
async function coach(first: string) {
  const person = await addPerson(first, 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await db.instructor.create({ data: { id: randomUUID(), userId: person.id, schoolId: s.schoolId } });
  return person;
}

test('a coach who teaches: the dialog shows what they teach, and "Give them to another coach" moves it', async ({ page }) => {
  const ana = await coach('Ana');
  const ben = await coach('Ben');
  const start = new Date(Date.now() + 2 * 86_400_000);
  const cls = await db.class.create({
    data: { id: randomUUID(), schoolId: s.schoolId, instructorId: ana.id, title: 'Kids BJJ', startDate: start, endDate: new Date(start.getTime() + 3_600_000) },
  });
  const slot = await db.timetableSlot.create({
    data: {
      id: randomUUID(), schoolId: s.schoolId, instructorId: ana.id, weekday: 'MONDAY', title: 'Monday Kids',
      startTime: new Date('1970-01-01T18:00:00Z'), endTime: new Date('1970-01-01T19:00:00Z'),
    },
  });

  await signIn(page, s.ownerToken);
  await page.goto('/staff');
  await listRow(page, 'Ana Coach').getByRole('button', { name: 'Actions for Ana Coach' }).click();
  await page.getByRole('menuitem', { name: 'Remove from School' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove Ana Coach from your School?' });
  await expect(dialog).toContainText('Ana Coach still teaches here: upcoming classes 1, weekly timetable slots 1.');

  // Nothing is removed until a choice is made.
  const remove = dialog.getByRole('button', { name: 'Remove from School' });
  await expect(remove).toBeDisabled();
  await expect(dialog.getByRole('radio', { name: /^No coach for now/ })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /^Cancel the classes/ })).toContainText('weekly slots stay on the timetable with no coach');

  await dialog.getByRole('radio', { name: /^Give them to another coach/ }).click();
  await expect(remove).toBeDisabled();
  await dialog.getByLabel('New coach').selectOption({ label: 'Ben Coach' });
  await remove.click();
  await expect(dialog).toHaveCount(0);
  await expect(listRow(page, 'Ana Coach')).toHaveCount(0);

  expect((await db.class.findUniqueOrThrow({ where: { id: cls.id } })).instructorId).toBe(ben.id);
  expect((await db.timetableSlot.findUniqueOrThrow({ where: { id: slot.id } })).instructorId).toBe(ben.id);
  expect(await db.roleGrant.count({ where: { userId: ana.id, schoolId: s.schoolId, revokedAt: null } })).toBe(0);
});

test('a coach who teaches nothing is removed with the plain confirmation', async ({ page }) => {
  const quinn = await coach('Quinn');
  await signIn(page, s.ownerToken);
  await page.goto('/staff');
  await listRow(page, 'Quinn Coach').getByRole('button', { name: 'Actions for Quinn Coach' }).click();
  await page.getByRole('menuitem', { name: 'Remove from School' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove Quinn Coach from your School?' });
  await expect(dialog.getByRole('button', { name: 'Remove from School' })).toBeEnabled();
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Remove from School' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await db.roleGrant.count({ where: { userId: quinn.id, schoolId: s.schoolId, revokedAt: null } })).toBe(0);
});
