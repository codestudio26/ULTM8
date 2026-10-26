import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The owner's answers on Curriculum (Decision 326), against the real API:
 * coaches and Branch Staff get the page read-only, the owner deletes a
 * category (its lessons move to "No category"), duration in minutes and
 * seconds, and the comments panel (coaches read, the owner deletes).
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // one lesson, "Armbar from guard", no category
});

test.afterAll(async () => {
  await cleanup();
});

const card = (page: Page, name: string) => page.locator('.ultm8-card', { has: page.getByRole('heading', { name, exact: true }) });

async function commentOn(lessonId: string, authorId: string, body: string) {
  await db.comment.create({ data: { id: randomUUID(), lessonId, authorId, schoolId: s.schoolId, body } });
}

test('a coach sees the curriculum and its comments, read-only', async ({ page }) => {
  const coach = await addPerson('Cara', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  const student = await addPerson('Sam', 'Student', [{ role: 'STUDENT', schoolId: s.schoolId }]);
  const lesson = await db.lesson.findFirstOrThrow({ where: { schoolId: s.schoolId } });
  await commentOn(lesson.id, student.id, 'How tight is the grip?');

  await signIn(page, coach.token);
  await page.goto('/coach');
  await page.getByRole('link', { name: 'Curriculum' }).click();
  await expect(page.getByText('Only the School owner can change them.', { exact: false })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Armbar from guard', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add lesson' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit Armbar from guard' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Categories' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Comments on Armbar from guard (1)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Comments on Armbar from guard' });
  await expect(dialog.getByText('How tight is the grip?')).toBeVisible();
  await expect(dialog.getByText('Sam Student')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Delete/ })).toHaveCount(0);
  await expect(dialog.getByText('Only the School owner can remove comments.')).toBeVisible();
});

test('the owner deletes a comment from the panel', async ({ page }) => {
  const student = await addPerson('Sam', 'Student', [{ role: 'STUDENT', schoolId: s.schoolId }]);
  const lesson = await db.lesson.findFirstOrThrow({ where: { schoolId: s.schoolId } });
  await commentOn(lesson.id, student.id, 'Spam spam spam');

  await signIn(page, s.ownerToken);
  await page.goto('/curriculum');
  await page.getByRole('button', { name: 'Comments on Armbar from guard (1)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Comments on Armbar from guard' });
  await dialog.getByRole('button', { name: "Delete Sam Student's comment" }).click();
  await expect(dialog.getByText('No comments yet.')).toBeVisible();
  await expect.poll(() => db.comment.count({ where: { lessonId: lesson.id } })).toBe(0);
});

test('the owner deletes a category and its lessons move to No category', async ({ page }) => {
  const lesson = await db.lesson.findFirstOrThrow({ where: { schoolId: s.schoolId } });
  const category = await db.lessonCategory.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'Submissions', order: 0 } });
  await db.lesson.update({ where: { id: lesson.id }, data: { categoryId: category.id } });

  await signIn(page, s.ownerToken);
  await page.goto('/curriculum');
  await expect(card(page, 'Submissions').getByRole('cell', { name: 'Armbar from guard', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Submissions' }).click();
  await expect(page.getByText('Its lessons (1) move to "No category".', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(card(page, 'No category').getByRole('cell', { name: 'Armbar from guard', exact: true })).toBeVisible();
  await expect.poll(async () => (await db.lesson.findUniqueOrThrow({ where: { id: lesson.id } })).categoryId).toBeNull();
});

test('duration is typed in minutes and seconds and listed as 4:30', async ({ page }) => {
  const lesson = await db.lesson.findFirstOrThrow({ where: { schoolId: s.schoolId } });
  await signIn(page, s.ownerToken);
  await page.goto('/curriculum');
  await card(page, 'No category').getByRole('button', { name: 'Edit Armbar from guard' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit lesson' });
  await dialog.getByLabel('Duration: minutes').fill('4');
  await dialog.getByLabel('Seconds').fill('30');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('cell', { name: '4:30' })).toBeVisible();
  expect((await db.lesson.findUniqueOrThrow({ where: { id: lesson.id } })).durationSeconds).toBe(270);
});
