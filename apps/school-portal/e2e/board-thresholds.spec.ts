import { expect, test, type Page } from '@playwright/test';
import { addStudent, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Grading Board columns per style (Decisions 75, 136, 181), against the real
 * API: shown on the board, changed with "Change %", and the board follows.
 */
let s: GradingSchool;
let cat: { id: string; name: string };

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool(); // Sam Lee: White 1, 3 of 3 classes (100%)
  cat = await addStudent(s, 'Cat', 'Ng', { rung: 'White 0', classes: 1, activeOverride: true }); // 1 of 3: 33%
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

const column = (page: Page, name: string) => page.getByRole('region', { name });

test('the board shows the style\'s columns; changing them moves students', async ({ page }) => {
  await page.goto('/grading');
  await expect(page.getByText('Columns at 33% / 66%')).toBeVisible();
  await expect(column(page, 'Getting There').getByText('33–65%')).toBeVisible();
  await expect(column(page, 'Getting There').getByRole('link', { name: cat.name })).toBeVisible();

  await page.getByRole('button', { name: 'Change %' }).click();
  const dialog = page.getByRole('dialog', { name: 'Board columns — BJJ' });
  await dialog.getByLabel('"Getting There" from (%)').fill('50');
  await dialog.getByLabel('"Ready to Grade" from (%)').fill('90');
  await expect(dialog.getByText('Just Starting: under 50% · Getting There: 50–89% · Ready to Grade: 90% and up')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByText('Columns at 50% / 90%')).toBeVisible();
  await expect(column(page, 'Just Starting').getByRole('link', { name: cat.name })).toBeVisible();
  await expect(column(page, 'Ready to Grade').getByRole('link', { name: s.student.name })).toBeVisible();
  expect(await db.discipline.findUniqueOrThrow({ where: { id: s.disciplineId } })).toMatchObject({ boardGettingThere: 50, boardReadyToGrade: 90 });
});

test('invalid values can\'t be saved; "Back to 33% / 66%" restores the default', async ({ page }) => {
  await db.discipline.update({ where: { id: s.disciplineId }, data: { boardGettingThere: 40, boardReadyToGrade: 80 } });
  await page.goto('/grading');
  await page.getByRole('button', { name: 'Change %' }).click();
  const dialog = page.getByRole('dialog', { name: 'Board columns — BJJ' });
  await dialog.getByLabel('"Getting There" from (%)').fill('85');
  await expect(dialog.getByRole('alert')).toContainText('"Getting There" below "Ready to Grade"');
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();

  await dialog.getByRole('button', { name: 'Back to 33% / 66%' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Columns at 33% / 66%')).toBeVisible();
});
