import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Lesson access in the portal (Decisions 190, 195), against the real API: a
 * plan ticks its styles and "Includes lessons" follows its price by default;
 * the owner makes a single lesson free.
 */
let s: GradingSchool;
const schoolIds: string[] = [];

test.beforeEach(async () => {
  s = await seedGradingSchool(); // BJJ; one lesson, "Armbar from guard"
  schoolIds.push(s.schoolId);
});

test.afterAll(async () => {
  await db.membershipPlan.deleteMany({ where: { schoolId: { in: schoolIds } } }); // plans hold their School
  await cleanup();
});

test('a priced plan includes lessons by default, a free one doesn\'t; both tick their styles', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/membership-plans');

  await page.getByRole('button', { name: 'Add plan' }).click();
  let dialog = page.getByRole('dialog', { name: 'Add membership plan' });
  await dialog.getByLabel('Type').selectOption({ label: 'Class Pack' });
  await dialog.getByLabel('Title').fill('Ten classes');
  await dialog.getByLabel('Price').fill('9000');
  await dialog.getByLabel(/Classes included/).fill('10');
  await dialog.getByLabel('BJJ').check();
  await expect(dialog.getByLabel('Includes lessons')).toBeChecked();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Add plan' }).click();
  dialog = page.getByRole('dialog', { name: 'Add membership plan' });
  await dialog.getByLabel('Type').selectOption({ label: 'Friend Pass' });
  await dialog.getByLabel('Title').fill('Bring a friend');
  await dialog.getByLabel(/Classes included/).fill('1');
  await dialog.getByLabel('BJJ').check();
  await expect(dialog.getByLabel('Includes lessons')).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  const plans = await db.membershipPlan.findMany({ where: { schoolId: s.schoolId }, orderBy: { title: 'asc' } });
  expect(plans.map((p) => [p.title, p.includesLessons, p.disciplineIds])).toEqual([
    ['Bring a friend', false, [s.disciplineId]],
    ['Ten classes', true, [s.disciplineId]],
  ]);
});

test('the owner makes a lesson free', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/curriculum');
  await page.getByRole('button', { name: 'Edit Armbar from guard' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit lesson' });
  await dialog.getByLabel('Free for everyone at the School').check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Free', { exact: true })).toBeVisible();
  expect((await db.lesson.findFirstOrThrow({ where: { schoolId: s.schoolId } })).free).toBe(true);
});
