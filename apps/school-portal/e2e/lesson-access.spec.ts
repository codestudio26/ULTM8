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

  // Add Membership Plan is now a dedicated full-page wizard, not a modal
  // (Decision 228) — Type/Title on step 1, Price/Classes included on step 2,
  // Disciplines/Includes lessons on step 4, Save on step 5. Step pills jump
  // directly, so Policies (step 3) doesn't need visiting here.
  await page.getByRole('button', { name: 'Add plan' }).click();
  await expect(page.getByRole('heading', { name: 'Add membership plan' })).toBeVisible();
  await page.getByLabel('Type').selectOption({ label: 'Class Pack' });
  await page.getByLabel('Title').fill('Ten classes');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Price').fill('9000');
  await page.getByLabel(/Classes included/).fill('10');
  await page.getByRole('button', { name: '4. Disciplines & Lessons' }).click();
  await page.getByLabel('BJJ').check();
  await expect(page.getByLabel('Includes lessons')).toBeChecked();
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/membership-plans$/);

  await page.getByRole('button', { name: 'Add plan' }).click();
  await expect(page.getByRole('heading', { name: 'Add membership plan' })).toBeVisible();
  await page.getByLabel('Type').selectOption({ label: 'Friend Pass' });
  await page.getByLabel('Title').fill('Bring a friend');
  await page.getByRole('button', { name: 'Next' }).click();
  // Classes included is forced to 1 and disabled for Friend Pass already.
  await page.getByRole('button', { name: '4. Disciplines & Lessons' }).click();
  await page.getByLabel('BJJ').check();
  await expect(page.getByLabel('Includes lessons')).not.toBeChecked();
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/membership-plans$/);

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
