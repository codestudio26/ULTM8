import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Ranks without a belt: Levels (backlog 3.19, Decision 290; DESIGN.md →
 * "Ranks without a belt"). A style shows its ranks as Belts or as Levels;
 * a level is a coloured badge with a dot per step, and its editor has a
 * badge colour and steps instead of belt colours and stripes.
 *
 * Seed: BJJ, White (3 rungs: White 0, 1, 2) and Blue (1 rung); Sam Lee on
 * White 1, the second of White's three.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

test('Grading → Settings switches a style to Levels; the board then shows badges', async ({ page }) => {
  await page.goto('/grading/settings');
  const select = page.getByLabel('BJJ: ranks shown as');
  await expect(select).toHaveValue('BELTS');
  await select.selectOption('LEVELS');
  await page.getByRole('region', { name: 'You have unsaved changes.' }).getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect.poll(async () => (await db.discipline.findUniqueOrThrow({ where: { id: s.disciplineId } })).rankDisplay).toBe('LEVELS');

  await page.goto('/grading');
  // Sam is on White 1: step 2 of White's 3.
  await expect(page.locator('[data-level-step="2/3"]').first()).toBeAttached();
});

test('the editor of a level has a badge colour and steps, and saves them without stripes', async ({ page }) => {
  await db.discipline.update({ where: { id: s.disciplineId }, data: { rankDisplay: 'LEVELS' } });
  await page.goto(`/disciplines/${s.disciplineId}`);
  await expect(page.getByText('3 steps')).toBeVisible();
  await page.getByRole('button', { name: 'Edit White' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit White' });
  await expect(dialog.getByRole('heading', { name: 'Steps of White' })).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Badge colour' })).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Tag colour (optional)' })).toHaveCount(0);
  await expect(dialog.getByRole('group', { name: 'Secondary colour (optional)' })).toHaveCount(0);
  await expect(dialog.getByText('Step 1 of 3')).toBeVisible();
  await dialog.getByRole('button', { name: '+ Add step' }).click();
  await expect(dialog.getByText('Step 4 of 4')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Remove White 4' })).toHaveText('Delete step');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  const tiers = await db.rankStripeTier.findMany({ where: { rankId: s.rung['White 0'].rankId }, orderBy: { order: 'asc' } });
  expect(tiers.map((t) => [t.name, t.count, t.stripeSegments])).toEqual([
    ['White 0', 0, []],
    ['White 1', 0, []],
    ['White 2', 0, []],
    ['White 4', 0, []],
  ]);
  // Sam keeps the rung they hold.
  expect((await db.studentRank.findFirstOrThrow({ where: { studentId: s.student.id } })).currentStripeId).toBe(s.rung['White 1'].id);
});

test('Add discipline can create a Levels style', async ({ page }) => {
  await page.goto('/disciplines');
  await page.getByRole('button', { name: 'Add discipline' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add discipline' });
  await dialog.getByLabel('Discipline name').fill('No-Gi');
  await dialog.getByLabel('Ranks shown as').selectOption('LEVELS');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await db.discipline.findFirst({ where: { schoolId: s.schoolId, name: 'No-Gi' } }))?.rankDisplay).toBe('LEVELS');
});
