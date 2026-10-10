import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Style templates and duplicate (Decisions 131, 182), against the real API:
 * a new style from an IBJJF template, and a copy of an existing style.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

test('start a style from an IBJJF template', async ({ page }) => {
  await page.goto('/disciplines');
  await page.getByRole('button', { name: 'Start from template' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start from a template' });
  await expect(dialog.getByRole('button', { name: 'Create style' })).toBeDisabled();
  await dialog.getByRole('radio', { name: /IBJJF Adult & Kid \(White & Red Stripes\)/ }).check();
  await expect(dialog.getByText('139 grades (each belt and each stripe)')).toBeVisible();
  await dialog.getByLabel('Style name').fill('Kids BJJ');
  await dialog.getByRole('button', { name: 'Create style' }).click();

  // Lands on the new style, ready to edit.
  await expect(page.getByRole('heading', { name: 'Kids BJJ' })).toBeVisible();
  await expect(page.getByText('White Belt', { exact: true }).first()).toBeVisible();

  const style = await db.discipline.findFirstOrThrow({ where: { schoolId: s.schoolId, name: 'Kids BJJ' } });
  expect(await db.rank.count({ where: { disciplineId: style.id } })).toBe(20);
  expect(await db.rankStripeTier.count({ where: { rank: { disciplineId: style.id } } })).toBe(139);
});

test('duplicate a style: ladder and skills, no students', async ({ page }) => {
  await page.goto('/disciplines');
  await page.getByRole('row', { name: /BJJ/ }).getByRole('button', { name: 'Duplicate' }).click();
  const dialog = page.getByRole('dialog', { name: 'Duplicate BJJ' });
  await expect(dialog.getByText('No students, ranks or coach permissions are copied.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Duplicate' }).click();

  await expect(page.getByRole('heading', { name: 'BJJ (Copy)' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Armbar' })).toBeVisible();

  const copy = await db.discipline.findFirstOrThrow({ where: { schoolId: s.schoolId, name: 'BJJ (Copy)' } });
  expect(await db.rankStripeTier.count({ where: { rank: { disciplineId: copy.id } } })).toBe(
    await db.rankStripeTier.count({ where: { rank: { disciplineId: s.disciplineId } } }),
  );
  expect(await db.studentRank.count({ where: { disciplineId: copy.id } })).toBe(0);
});
