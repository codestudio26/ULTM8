import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'crypto';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Lesson categories (Decisions 128.15, 191), against the real API: the owner
 * adds categories, orders them and the lessons within them, and moves a
 * lesson to another category from its form.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // one lesson, "Armbar from guard", no category
});

test.afterAll(async () => {
  await cleanup(); // categories go with their School
});

const card = (page: Page, name: string) => page.locator('.ultm8-card', { has: page.getByRole('heading', { name, exact: true }) });
const lessonTitles = async (page: Page, category: string) =>
  (await card(page, category).locator('tr > :first-child').allTextContents()).filter((t) => t !== 'Title');

test('add categories, order them, and move lessons between and within them', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/curriculum');
  for (const name of ['Submissions', 'Guard Work']) {
    await page.getByLabel('New category').fill(name);
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(page.getByRole('list', { name: 'Categories' }).getByRole('listitem', { name })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Move Guard Work up' }).click();
  await expect(page.getByRole('list', { name: 'Categories' }).getByRole('listitem')).toHaveText([/Guard Work/, /Submissions/]);

  // The seeded lesson has no category; put it in Submissions from its form.
  await card(page, 'No category').getByRole('button', { name: 'Edit Armbar from guard' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit lesson' });
  await dialog.getByLabel('Category').selectOption({ label: 'Submissions' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(card(page, 'Submissions').getByText('Armbar from guard')).toBeVisible();

  // A second lesson in Submissions, then reorder the two.
  const lesson = await db.lesson.findFirstOrThrow({ where: { schoolId: s.schoolId } });
  const category = await db.lessonCategory.findFirstOrThrow({ where: { schoolId: s.schoolId, name: 'Submissions' } });
  await db.lesson.create({ data: { id: randomUUID(), schoolId: s.schoolId, title: 'Rear naked choke', format: 'PRERECORDED', categoryId: category.id, order: 5 } });
  await page.reload();
  await expect.poll(() => lessonTitles(page, 'Submissions')).toEqual([lesson.title, 'Rear naked choke']);
  await page.getByRole('button', { name: 'Move Rear naked choke up' }).click();
  await expect.poll(() => lessonTitles(page, 'Submissions')).toEqual(['Rear naked choke', lesson.title]);
});

test('a category can be renamed; a duplicate name is refused', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/curriculum');
  await page.getByLabel('New category').fill('Escapes');
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByRole('list', { name: 'Categories' }).getByRole('listitem', { name: 'Escapes' })).toBeVisible();
  await page.getByLabel('New category').fill('escapes');
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByText('There is already a category called "escapes".')).toBeVisible();

  await page.getByRole('button', { name: 'Rename Escapes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename Escapes' });
  await dialog.getByLabel('Name').fill('Escapes & Defence');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('list', { name: 'Categories' }).getByRole('listitem', { name: 'Escapes & Defence' })).toBeVisible();
});
