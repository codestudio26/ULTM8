import { expect, test } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Disciplines review (Decisions 308, 309), against the real API: class types
 * edited as a list (a rename carries over), archiving a style, the skills'
 * context columns and the students list, and the read-only page for coaches.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

test('class types are a list: add one, then rename it and the rungs follow', async ({ page }) => {
  await page.goto('/disciplines');
  await page.getByRole('row', { name: /BJJ/ }).getByRole('button', { name: 'Edit' }).click();
  let dialog = page.getByRole('dialog', { name: 'Edit discipline' });
  await dialog.getByRole('button', { name: 'Add class type' }).click();
  await dialog.getByLabel('Class type 1', { exact: true }).fill('Kids');
  await dialog.getByRole('button', { name: 'Add class type' }).click();
  await dialog.getByLabel('Class type 2', { exact: true }).fill('kids');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('"kids" is listed twice.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove class type 2' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('row', { name: /BJJ/ }).getByRole('cell', { name: 'Kids', exact: true })).toBeVisible();

  // A rung counts "Kids" classes; renaming the type carries onto it.
  await db.rankStripeTier.update({ where: { id: s.rung['White 1'].id }, data: { eligibleClassTypes: ['Kids'] } });
  await page.getByRole('row', { name: /BJJ/ }).getByRole('button', { name: 'Edit' }).click();
  dialog = page.getByRole('dialog', { name: 'Edit discipline' });
  await dialog.getByLabel('Class type 1', { exact: true }).fill('Kids Fundamentals');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('row', { name: /BJJ/ }).getByRole('cell', { name: 'Kids Fundamentals', exact: true })).toBeVisible();
  expect((await db.rankStripeTier.findUniqueOrThrow({ where: { id: s.rung['White 1'].id } })).eligibleClassTypes).toEqual(['Kids Fundamentals']);

  // Removing a type a rung uses is refused, with the reason.
  await page.getByRole('row', { name: /BJJ/ }).getByRole('button', { name: 'Edit' }).click();
  dialog = page.getByRole('dialog', { name: 'Edit discipline' });
  await dialog.getByRole('button', { name: 'Remove class type 1' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText(/"Kids Fundamentals" is used by 1 rung on the ladder/)).toBeVisible();
});

test('a blank or repeated name is refused', async ({ page }) => {
  await page.goto('/disciplines');
  await page.getByRole('button', { name: 'Add discipline' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add discipline' });
  await dialog.getByLabel('Discipline name').fill('   ');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Enter a name.')).toBeVisible();
  await dialog.getByLabel('Discipline name').fill('bjj');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('A discipline called "bjj" already exists.')).toBeVisible();
});

test('archive a style: it leaves the list, shows under "Show archived", and comes back', async ({ page }) => {
  await page.goto('/disciplines');
  await expect(page.getByRole('row', { name: /BJJ/ }).getByRole('cell', { name: '1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Archive BJJ' }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive BJJ?' });
  await expect(dialog.getByText(/students keep their rank and history/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('row', { name: /BJJ/ })).toHaveCount(0);

  await page.getByLabel('Show archived').check();
  const row = page.getByRole('row', { name: /BJJ/ });
  await expect(row.getByText('Archived', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Edit' })).toHaveCount(0);

  // Read-only while archived.
  await row.getByRole('button', { name: 'Skills and belts of BJJ' }).click();
  await expect(page.getByText(/This style is archived/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add skill' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add belt' })).toHaveCount(0);

  await page.goto('/disciplines');
  await page.getByLabel('Show archived').check();
  await page.getByRole('button', { name: 'Unarchive BJJ' }).click();
  await expect(page.getByRole('row', { name: /BJJ/ }).getByText('Archived', { exact: true })).toHaveCount(0);
  expect((await db.discipline.findUniqueOrThrow({ where: { id: s.disciplineId } })).archivedAt).toBeNull();
});

test('skills show which rungs need them and their lessons; the owner sees who trains the style', async ({ page }) => {
  await page.goto(`/disciplines/${s.disciplineId}`);
  const armbar = page.getByRole('row', { name: /Armbar/ });
  await expect(armbar.getByRole('cell', { name: 'White 2', exact: true })).toBeVisible();
  await expect(armbar.getByRole('cell', { name: '1', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add skill' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add skill' });
  await dialog.getByLabel('Name').fill('Triangle');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('row', { name: /Triangle/ })).toBeVisible();
  await page.getByRole('button', { name: 'Move Triangle up' }).click();
  await expect(page.getByRole('row').nth(1)).toContainText('Triangle');

  await expect(page.getByRole('heading', { name: 'Students (1)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sam Lee' })).toBeVisible();
});

test('a coach sees the Disciplines page read-only', async ({ page }) => {
  const coach = await addPerson('Cara', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await page.context().clearCookies();
  await signIn(page, coach.token);
  await page.goto('/coach');
  await page.getByRole('link', { name: 'Disciplines' }).click();
  await expect(page.getByText('Only the School owner can change them.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add discipline' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Skills and belts of BJJ' }).click();
  await expect(page.getByText('Only the School owner can change this style.')).toBeVisible();
  await expect(page.getByText('White 2').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add skill' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add belt' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Students \(/ })).toHaveCount(0);
});
