import { expect, test } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Staff notes on a student (backlog 3.10, Decision 400): any staff who can
 * see the student add notes, staff-only or shown to the member; only the
 * author or an owner edits or deletes one.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterAll(async () => {
  await cleanup();
});

const notes = (page: import('@playwright/test').Page) => page.locator('.ultm8-card').filter({ has: page.getByRole('heading', { name: 'Notes', exact: true }) });

test('the owner adds a staff-only note and a shown one, edits one and deletes the other', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto(`/students/${s.student.id}`);
  const card = notes(page);
  await expect(card.getByText('No notes yet.')).toBeVisible();

  await card.getByLabel('New note').fill('Working on guard retention.');
  await card.getByRole('button', { name: 'Add note' }).click();
  await expect(card.getByText('Working on guard retention.')).toBeVisible();
  await expect(card.getByText('Staff only')).toBeVisible();

  await card.getByLabel('New note').fill('Great work at the open mat!');
  await card.getByLabel('Show to member').check();
  await card.getByRole('button', { name: 'Add note' }).click();
  const shown = card.getByRole('listitem').filter({ hasText: 'Great work at the open mat!' });
  await expect(shown.getByText('Shown to student')).toBeVisible();
  await expect(card.getByRole('listitem').first()).toContainText('Great work at the open mat!');

  // Newest first: the staff-only note is second. (While editing, its text is in the box.)
  const staffOnly = card.getByRole('listitem').nth(1);
  await expect(staffOnly).toContainText('Working on guard retention.');
  await staffOnly.getByRole('button', { name: 'Edit' }).click();
  await staffOnly.getByLabel('Edit note').fill('Working on guard retention and posture.');
  await staffOnly.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByText('Working on guard retention and posture.')).toBeVisible();
  await expect(card.getByRole('listitem').filter({ hasText: 'posture' }).getByText(/edited/)).toBeVisible();

  await shown.getByRole('button', { name: 'Delete' }).click();
  await shown.getByRole('button', { name: 'Delete' }).click();
  await expect(card.getByText('Great work at the open mat!')).toHaveCount(0);
  const rows = await db.studentNote.findMany({ where: { studentId: s.student.id } });
  expect(rows).toEqual([expect.objectContaining({ body: 'Working on guard retention and posture.', showToMember: false, authorId: s.ownerId })]);
});

test("a coach adds their own note, reads the owner's, but can't change it", async ({ page }) => {
  await db.studentNote.create({ data: { id: crypto.randomUUID(), schoolId: s.schoolId, studentId: s.student.id, authorId: s.ownerId, body: 'Owner note' } });
  const coach = await addPerson('Cora', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await signIn(page, coach.token);
  await page.goto(`/students/${s.student.id}`);
  const card = notes(page);
  const ownerNote = card.getByRole('listitem').filter({ hasText: 'Owner note' });
  await expect(ownerNote).toBeVisible();
  await expect(ownerNote.getByRole('button', { name: 'Edit' })).toHaveCount(0);

  await card.getByLabel('New note').fill('Coach note');
  await card.getByRole('button', { name: 'Add note' }).click();
  const mine = card.getByRole('listitem').filter({ hasText: 'Coach note' });
  await expect(mine.getByText('Cora Coach')).toBeVisible();
  await expect(mine.getByRole('button', { name: 'Edit' })).toBeVisible();
});
