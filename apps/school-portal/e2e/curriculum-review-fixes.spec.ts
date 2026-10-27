import { expect, test, type Page } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Curriculum review fixes (Decision 324), against the real API: clearing a
 * lesson's fields on edit (C1), a blank title (C6), Upload video greyed out
 * while video uploads aren't set up (C4), the "No category" hint (C12) and
 * the delete warning (C13).
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // one lesson, "Armbar from guard", no category
});

test.afterAll(async () => {
  await cleanup();
});

const card = (page: Page, name: string) => page.locator('.ultm8-card', { has: page.getByRole('heading', { name, exact: true }) });

test('emptying description and duration on edit clears them', async ({ page }) => {
  const lesson = await db.lesson.findFirstOrThrow({ where: { schoolId: s.schoolId } });
  await db.lesson.update({ where: { id: lesson.id }, data: { durationSeconds: 300 } });
  await db.lessonContent.upsert({ where: { lessonId: lesson.id }, create: { lessonId: lesson.id, description: 'Old steps' }, update: { description: 'Old steps' } });

  await signIn(page, s.ownerToken);
  await page.goto('/curriculum');
  await card(page, 'No category').getByRole('button', { name: 'Edit Armbar from guard' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit lesson' });
  await expect(dialog.getByLabel('Description')).toHaveValue('Old steps');
  await dialog.getByLabel('Description').fill('');
  await dialog.getByLabel('Duration: minutes').fill('');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  await expect.poll(async () => (await db.lesson.findUniqueOrThrow({ where: { id: lesson.id } })).durationSeconds).toBeNull();
  expect((await db.lessonContent.findUniqueOrThrow({ where: { lessonId: lesson.id } })).description).toBeNull();
});

test('a title of only spaces is refused', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/curriculum');
  await card(page, 'No category').getByRole('button', { name: 'Edit Armbar from guard' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit lesson' });
  await dialog.getByLabel('Title', { exact: true }).fill('   ');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Give this lesson a title.')).toBeVisible();
});

test('Upload video is greyed out with a reason while video uploads are off; hint and delete warning', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/curriculum');
  // The test API runs with no Cloudflare account, like the live site today.
  await expect(page.getByText("Video uploads aren't set up yet.", { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload video for Armbar from guard' })).toBeDisabled();
  await expect(card(page, 'No category').getByText('Put lessons in a category to choose their order.')).toBeVisible();

  await page.getByRole('button', { name: 'Delete Armbar from guard' }).click();
  await expect(page.getByText('To hide it but keep these, use Archive.', { exact: false })).toBeVisible();
});
