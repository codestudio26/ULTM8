import { expect, test, type Page } from '@playwright/test';
import { cleanup, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Student grading panel (roadmap Phase 4, item 2), against the real API:
 * rank, progress and skills; skill sign-off; grading with the skill
 * acknowledgement; moving down; voiding; a first rank; keyboard-only use.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

const bjj = (page: Page) => page.getByRole('region', { name: 'BJJ' });

test('the Students list opens a student\'s grading panel', async ({ page }) => {
  await page.goto('/students');
  await page.getByRole('link', { name: s.student.name }).click();
  await expect(page).toHaveURL(new RegExp(`/students/${s.student.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: s.student.name })).toBeVisible();
});

test('shows the current rank, progress toward the next rank and the skills for it', async ({ page }) => {
  await page.goto(`/students/${s.student.id}`);
  const card = bjj(page);
  await expect(card.getByText('White 1', { exact: true })).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Toward White 2 — 100%' })).toBeVisible();
  await expect(card.getByText('Classes: 3 of 3')).toBeVisible();
  await expect(card.getByText('Skills: 0 of 1 signed off')).toBeVisible();
  await expect(card.getByRole('link', { name: 'Armbar from guard' })).toBeVisible();
  await expect(card.getByText('Ready to grade')).toHaveCount(0);
});

test('signing off the last skill makes the student ready to grade', async ({ page }) => {
  await page.goto(`/students/${s.student.id}`);
  const card = bjj(page);
  await card.getByRole('button', { name: 'Armbar: Not started. Change to Learning' }).click();
  await card.getByRole('button', { name: 'Armbar: Learning. Change to Signed off' }).click();
  await expect(card.getByRole('button', { name: 'Armbar: Signed off. Change to Not started' })).toBeVisible();
  await expect(card.getByText('Skills: 1 of 1 signed off')).toBeVisible();
  await expect(card.getByText('Ready to grade')).toBeVisible();
});

test('grading without the skill needs the acknowledgement, and is recorded', async ({ page }) => {
  await page.goto(`/students/${s.student.id}`);
  const card = bjj(page);
  await card.getByRole('button', { name: 'Grade' }).click();
  const dialog = page.getByRole('dialog', { name: 'Grade — BJJ' });
  await expect(dialog.getByLabel('New rank')).toHaveValue(s.rung['White 2'].id);
  const submit = dialog.getByRole('button', { name: 'Award stripe' });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel(/Grade without all skills signed off/).check();
  await dialog.getByLabel('Note').fill('Great roll today');
  await submit.click();
  await expect(dialog).toBeHidden();

  await expect(card.getByText('White 2', { exact: true })).toBeVisible();
  const history = card.getByRole('list').last();
  await expect(history.getByText('Stripe awarded')).toBeVisible();
  await expect(history.getByText('White 1 → White 2')).toBeVisible();
  await expect(history.getByText('Graded without all skills signed off (acknowledged).')).toBeVisible();
  await expect(history.getByText('Note: Great roll today')).toBeVisible();
});

test('a style that requires skills blocks grading until they are signed off', async ({ page }) => {
  const { db } = await import('./fixtures');
  await db.discipline.update({ where: { id: s.disciplineId }, data: { skillsRequiredToGrade: true } });
  await page.goto(`/students/${s.student.id}`);
  await bjj(page).getByRole('button', { name: 'Grade' }).click();
  const dialog = page.getByRole('dialog', { name: 'Grade — BJJ' });
  await expect(dialog.getByText(/requires every skill for the next rank to be signed off/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Award stripe' })).toBeDisabled();
});

test('moving down needs a reason; a voided entry is hidden unless asked for', async ({ page }) => {
  await page.goto(`/students/${s.student.id}`);
  const card = bjj(page);
  await card.getByRole('button', { name: 'Move down' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move down — BJJ' });
  const submit = dialog.getByRole('button', { name: 'Move down' });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('Reason').fill('Missed the basics');
  await submit.click();
  await expect(dialog).toBeHidden();
  await expect(card.getByText('White 0', { exact: true })).toBeVisible();
  await expect(card.getByText('Reason: Missed the basics')).toBeVisible();

  await card.getByRole('button', { name: /^Void entry: Moved down/ }).click();
  const voidDialog = page.getByRole('dialog', { name: 'Void history entry' });
  await voidDialog.getByLabel('Reason').fill('Entered by mistake');
  await voidDialog.getByRole('button', { name: 'Void entry' }).click();
  await expect(voidDialog).toBeHidden();
  await expect(card.getByText('Reason: Missed the basics')).toHaveCount(0);

  await page.getByLabel('Show voided history entries').check();
  await expect(card.getByText('Voided', { exact: true })).toBeVisible();
  await expect(card.getByText(/by You: Entered by mistake/)).toBeVisible();
});

test('a student with no rank gets a first rank', async ({ page }) => {
  await page.goto(`/students/${s.newStudent.id}`);
  const card = bjj(page);
  await expect(card.getByText('No rank in this style yet.')).toBeVisible();
  await card.getByRole('button', { name: 'Give first rank' }).click();
  const dialog = page.getByRole('dialog', { name: 'Give a first rank — BJJ' });
  await expect(dialog.getByLabel('New rank')).toHaveValue(s.rung['White 0'].id);
  await dialog.getByRole('button', { name: 'Grade' }).click();
  await expect(dialog).toBeHidden();
  await expect(card.getByText('White 0', { exact: true })).toBeVisible();
  await expect(card.getByText('Promoted', { exact: true })).toBeVisible();
});

test('works with the keyboard only', async ({ page }) => {
  await page.goto(`/students/${s.newStudent.id}`);
  const card = bjj(page);
  await expect(card.getByRole('button', { name: 'Give first rank' })).toBeVisible();

  // Tab to the button, open the form with Enter, fill it and submit.
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    if (await card.getByRole('button', { name: 'Give first rank' }).evaluate((el) => el === document.activeElement)) break;
  }
  await expect(card.getByRole('button', { name: 'Give first rank' })).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Give a first rank — BJJ' });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    if (await dialog.getByLabel('Note').evaluate((el) => el === document.activeElement)) break;
  }
  await page.keyboard.type('Keyboard grade');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Grade' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(card.getByText('Note: Keyboard grade')).toBeVisible();
});
