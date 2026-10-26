import { expect, test } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Grading → Settings and Skills (DESIGN.md → "Grading screens"): board
 * columns per style, the owner-only promotion fee, open mat hours, one
 * Discard / Save changes bar; and the Skills tab with its side panel.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterAll(async () => {
  await cleanup();
});

test('the owner changes columns, the promotion fee and open mat hours, then saves once', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/grading');
  await page.getByRole('navigation', { name: 'Grading' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/grading\/settings$/);

  await page.getByLabel('BJJ: "Getting There" from (%)').fill('50');
  await page.getByLabel('BJJ: "Ready to Grade" from (%)').fill('90');
  const fee = page.getByRole('switch', { name: 'Promotion fee' });
  await expect(fee).toHaveAttribute('aria-checked', 'false');
  await fee.click();
  await page.getByRole('switch', { name: 'Allow grading before the fee is paid' }).click();
  await page.getByRole('switch', { name: 'Open mat counts toward hours' }).click();
  await expect(page.getByRole('heading', { name: 'Open mat counts toward hours' })).toBeVisible(); // About this setting follows

  const bar = page.getByRole('region', { name: 'You have unsaved changes.' });
  await bar.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(bar).toHaveCount(0);

  const style = await db.discipline.findUniqueOrThrow({ where: { id: s.disciplineId } });
  expect([style.boardGettingThere, style.boardReadyToGrade]).toEqual([50, 90]);
  const school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(school).toMatchObject({ promotionFeeEnabled: true, promotionFeeGradeBeforePaid: true, openMatCountsTowardHours: true });
});

test('Discard puts the saved values back; a wrong % keeps Save off', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/grading/settings');
  const g = page.getByLabel('BJJ: "Getting There" from (%)');
  await g.fill('80');
  const bar = page.getByRole('region', { name: 'You have unsaved changes.' });
  await expect(page.getByRole('alert')).toContainText('"Getting There" below "Ready to Grade"');
  await expect(bar.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await bar.getByRole('button', { name: 'Discard' }).click();
  await expect(g).toHaveValue('33');
  await expect(bar).toHaveCount(0);
});

test('a coach sees the promotion fee but only the owner can change it', async ({ page }) => {
  const coach = await addPerson('Cody', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await signIn(page, coach.token);
  await page.goto('/grading/settings');
  await expect(page.getByText('Only the School owner can change the promotion fee.')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Promotion fee' })).toBeDisabled();
});

test('the Skills tab lists a style\'s skills; picking one shows the grades that require it', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/grading/skills');
  const list = page.getByRole('list', { name: 'Skills in BJJ' });
  await expect(list.getByRole('listitem', { name: 'Armbar' }).getByText('Required by 1 grades · taught in 1 lessons')).toBeVisible();
  await list.getByRole('listitem', { name: 'Armbar' }).getByText('Armbar').click();
  const panel = page.getByRole('region', { name: 'Skill: Armbar' });
  await expect(panel.getByText('White 2')).toBeVisible();

  await page.getByRole('button', { name: '+ Add skill' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Kimura');
  await dialog.getByRole('button', { name: /Save|Add/ }).click();
  await expect(list.getByRole('listitem', { name: 'Kimura' })).toBeVisible();
  expect(await db.skill.count({ where: { disciplineId: s.disciplineId, name: 'Kimura' } })).toBe(1);
});
