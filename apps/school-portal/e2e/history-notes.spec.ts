import { expect, test } from '@playwright/test';
import { randomUUID } from 'crypto';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * History notes (Decision 192), against the real API: a grader edits a note
 * and hides it from the student; the owner sees every change.
 */
let s: GradingSchool;
let entryId = '';

test.beforeEach(async () => {
  s = await seedGradingSchool(); // Sam Lee at White 1
  const sr = await db.studentRank.findFirstOrThrow({ where: { studentId: s.student.id } });
  entryId = randomUUID();
  await db.promotionEvent.create({
    data: {
      id: entryId, studentRankId: sr.id, schoolId: s.schoolId, studentId: s.student.id, type: 'PROMOTION', performedById: s.ownerId,
      fromRankId: s.rung['White 0'].rankId, toRankId: s.rung['White 1'].rankId, fromStripeTierId: s.rung['White 0'].id, toStripeTierId: s.rung['White 1'].id,
      note: 'Good base',
    },
  });
});

test.afterAll(async () => {
  await cleanup();
});

test('edit a note, hide it from the student, and read the changes', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto(`/students/${s.student.id}`);
  await expect(page.getByText('Note: Good base')).toBeVisible();

  await page.getByRole('button', { name: /^Edit note: / }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit note' });
  await dialog.getByLabel('Note').fill('Good base, keep elbows in');
  await dialog.getByRole('button', { name: 'Save note' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Note: Good base, keep elbows in')).toBeVisible();
  await expect(page.getByText(/^Edited /)).toBeVisible();

  await page.getByRole('button', { name: /^Hide note: / }).click();
  await expect(page.getByText('Hidden from the student')).toBeVisible();
  const row = await db.promotionEvent.findUniqueOrThrow({ where: { id: entryId } });
  expect(row.noteHiddenAt).not.toBeNull();

  await page.getByRole('button', { name: /^Note changes: / }).click();
  const log = page.getByRole('dialog', { name: 'Note changes' }).getByRole('list', { name: 'Note changes' });
  await expect(log.getByRole('listitem')).toHaveCount(2);
  await expect(log.getByRole('listitem').nth(0)).toContainText('Edited');
  await expect(log.getByRole('listitem').nth(0)).toContainText('From “Good base” to “Good base, keep elbows in”');
  await expect(log.getByRole('listitem').nth(1)).toContainText('Hidden from the student');
});
