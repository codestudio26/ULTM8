import { expect, test } from '@playwright/test';
import { addCoach, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Grading permissions page (Decisions 138, 181), against the real API: the
 * owner gives a coach a style and its seven toggles, saved per coach.
 */
let s: GradingSchool;
let carla: { id: string; name: string };

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  carla = await addCoach(s, 'Carla', 'Reyes');
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

const permissionOf = () => db.gradingPermission.findFirst({ where: { userId: carla.id, disciplineId: s.disciplineId } });

test('lists coaches; "May grade" turns every toggle on, and toggles can be turned off', async ({ page }) => {
  await page.goto('/grading-permissions');
  const section = page.getByRole('region', { name: carla.name });
  await expect(section.getByText('Instructor')).toBeVisible();
  const promote = section.getByLabel(`${carla.name}, BJJ: Promote`);
  await expect(promote).toBeDisabled();
  await expect(section.getByRole('button', { name: `Save permissions for ${carla.name}` })).toBeDisabled();

  await section.getByLabel(`${carla.name} may grade in BJJ`).check();
  await expect(promote).toBeChecked();
  await section.getByLabel(`${carla.name}, BJJ: Move down`).uncheck();
  await section.getByLabel(`${carla.name}, BJJ: Change board %`).uncheck();
  await section.getByRole('button', { name: `Save permissions for ${carla.name}` }).click();
  await expect(section.getByText('Saved.')).toBeVisible();

  expect(await permissionOf()).toMatchObject({
    canPromote: true,
    canDowngrade: false,
    canSignOffSkills: true,
    canAdjustProgress: true,
    canVerifyRanks: true,
    canVoidHistory: true,
    canChangeBoardThresholds: false,
  });

  await page.reload();
  await expect(page.getByLabel(`${carla.name}, BJJ: Move down`)).not.toBeChecked();
  await expect(page.getByLabel(`${carla.name}, BJJ: Promote`)).toBeChecked();
});

test('unticking "May grade" removes the style; Undo puts back what is saved', async ({ page }) => {
  await db.gradingPermission.create({ data: { id: crypto.randomUUID(), schoolId: s.schoolId, userId: carla.id, disciplineId: s.disciplineId } });
  await page.goto('/grading-permissions');
  const section = page.getByRole('region', { name: carla.name });
  const mayGrade = section.getByLabel(`${carla.name} may grade in BJJ`);
  await expect(mayGrade).toBeChecked();

  await mayGrade.uncheck();
  await section.getByRole('button', { name: 'Undo' }).click();
  await expect(mayGrade).toBeChecked();

  await mayGrade.uncheck();
  await section.getByRole('button', { name: `Save permissions for ${carla.name}` }).click();
  await expect(section.getByText('Saved.')).toBeVisible();
  expect(await permissionOf()).toBeNull();
});

test('works with the keyboard only', async ({ page }) => {
  await page.goto('/grading-permissions');
  const mayGrade = page.getByLabel(`${carla.name} may grade in BJJ`);
  await expect(mayGrade).toBeVisible();
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    if (await mayGrade.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(mayGrade).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab'); // Promote
  await page.keyboard.press('Space'); // off
  const save = page.getByRole('button', { name: `Save permissions for ${carla.name}` });
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Shift+Tab');
    if (await save.evaluate((el) => el === document.activeElement)) break;
  }
  await page.keyboard.press('Enter');
  await expect(page.getByText('Saved.')).toBeVisible();
  expect(await permissionOf()).toMatchObject({ canPromote: false, canDowngrade: true });
});
