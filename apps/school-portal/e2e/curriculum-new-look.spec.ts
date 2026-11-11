import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The Curriculum page in the new look (Decision 453). The approved design
 * draws no Curriculum screen, so the page keeps its layout and features: the
 * new-look page header (Add lesson for the owner), the Categories card, one
 * card per category with its lessons, and the lesson form's drop-downs as the
 * new look's own (never a browser <select>). On a phone each lesson is a
 * card and nothing scrolls sideways.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // BJJ with the skill Armbar; one lesson, "Armbar from guard", no category
});

test.afterAll(async () => {
  await cleanup();
});

const card = (page: Page, name: string) => page.locator('.u8c-card', { has: page.getByRole('heading', { name, exact: true }) });

test('the owner sees the new-look header, cards and lesson row', async ({ page }) => {
  const category = await db.lessonCategory.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'Submissions', order: 0 } });
  await db.lesson.updateMany({ where: { schoolId: s.schoolId }, data: { categoryId: category.id, durationSeconds: 270, free: true } });

  await signIn(page, s.ownerToken);
  await page.goto('/curriculum');
  const header = page.locator('.u8n-page-header');
  await expect(header.getByRole('heading', { level: 1, name: 'Curriculum' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Add lesson' })).toBeVisible();

  // The Categories card with the category's own row and its buttons.
  const categories = page.getByRole('list', { name: 'Categories' });
  const row = categories.getByRole('listitem', { name: 'Submissions' });
  await expect(row.getByRole('button', { name: 'Rename Submissions' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Move Submissions up' })).toBeDisabled();
  await expect(card(page, 'Categories').getByLabel('New category')).toBeVisible();

  // The category's card lists the lesson with its tags and columns.
  const lessons = card(page, 'Submissions');
  const lesson = lessons.getByRole('row', { name: /Armbar from guard/ });
  await expect(lesson.getByText('Free', { exact: true })).toBeVisible();
  await expect(lesson.getByText('Prerecorded', { exact: true })).toBeVisible();
  await expect(lesson.getByRole('cell', { name: '4:30' })).toBeVisible();
  for (const name of ['Comments on Armbar from guard (0)', 'Edit Armbar from guard', 'Archive Armbar from guard', 'Delete Armbar from guard']) {
    await expect(lesson.getByRole('button', { name })).toBeVisible();
  }
  // Nothing of the old look is left on the page.
  await expect(page.locator('.ultm8-card')).toHaveCount(0);
  await expect(page.locator('.ultm8-page-header')).toHaveCount(0);
});

test('the lesson form uses the new look\'s own drop-downs and still saves', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/curriculum');
  await page.getByRole('button', { name: 'Add lesson' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add lesson' });
  await expect(dialog.locator('select')).toHaveCount(0);
  for (const name of ['Category', 'Format', 'Instructor']) await expect(dialog.getByRole('combobox', { name })).toBeVisible();

  await dialog.getByLabel('Title', { exact: true }).fill('Kimura from guard');
  const format = dialog.getByRole('combobox', { name: 'Format' });
  await expect(format.locator('[data-shown="true"]')).toHaveText('Prerecorded');
  await format.click();
  await dialog.getByRole('listbox', { name: 'Format' }).getByRole('option', { name: 'Live' }).click();
  await expect(format.locator('[data-shown="true"]')).toHaveText('Live');
  await dialog.getByLabel('Armbar').check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  await expect(card(page, 'No category').getByRole('row', { name: /Kimura from guard/ }).getByText('Live', { exact: true })).toBeVisible();
  const saved = await db.lesson.findFirstOrThrow({ where: { schoolId: s.schoolId, title: 'Kimura from guard' } });
  expect(saved.format).toBe('LIVE');
});

test('changing only a drop-down counts as an edit: the dialog stays open on an outside click and Escape', async ({ page }) => {
  await db.lessonCategory.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'Submissions', order: 0 } });
  await signIn(page, s.ownerToken);
  await page.goto('/curriculum');
  const edit = card(page, 'No category').getByRole('button', { name: 'Edit Armbar from guard' });
  const dialog = page.getByRole('dialog', { name: 'Edit lesson' });

  // Untouched, the dialog closes on Escape as before.
  await edit.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Change only the Category drop-down.
  await edit.click();
  const category = dialog.getByRole('combobox', { name: 'Category' });
  await category.click();
  await dialog.getByRole('option', { name: 'Submissions' }).click();
  await expect(category.locator('[data-shown="true"]')).toHaveText('Submissions');

  // A click on the dimmed page outside the dialog keeps it open.
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  // So does Escape.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(category.locator('[data-shown="true"]')).toHaveText('Submissions');
});

test('a coach gets the page read-only in the new look', async ({ page }) => {
  const coach = await addPerson('Cara', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await signIn(page, coach.token);
  await page.goto('/curriculum');
  await expect(page.locator('.u8n-page-header').getByRole('heading', { level: 1, name: 'Curriculum' })).toBeVisible();
  await expect(page.getByText('Only the School owner can change them.', { exact: false })).toBeVisible();
  const lesson = card(page, 'No category').getByRole('row', { name: /Armbar from guard/ });
  await expect(lesson.getByRole('button', { name: 'Comments on Armbar from guard (0)' })).toBeVisible();
  await expect(lesson.getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Add lesson' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Categories' })).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('each lesson is a card and nothing scrolls sideways', async ({ page }) => {
    await db.lesson.updateMany({ where: { schoolId: s.schoolId }, data: { durationSeconds: 270 } });
    await signIn(page, s.ownerToken);
    await page.goto('/curriculum');
    const lessons = card(page, 'No category');
    await expect(lessons.getByRole('button', { name: 'Edit Armbar from guard' })).toBeVisible();
    // The column headings give way to a small label in front of each value.
    await expect(lessons.locator('thead')).toBeHidden();
    await expect(lessons.locator('.u8c-cell-label', { hasText: 'Duration' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await lessons.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
  });
});
