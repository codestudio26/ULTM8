import { expect, test } from '@playwright/test';
import { addBranch, addPerson, addStudent, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Disciplines review (Decisions 308, 309), against the real API: class types
 * edited as a list (a rename carries over), archiving a style, the skills'
 * context columns and the students list, and the read-only page for coaches.
 * Then the leftovers (Decision 310): a student's rank in an archived style,
 * and students who left the School. Then Decision 383: Branch Staff the owner
 * lets manage disciplines, and deleting an archived style permanently.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

test('class types are a list: add one, then rename it and the rungs follow', async ({ page }) => {
  await page.goto('/disciplines');
  await page.getByRole('row', { name: /BJJ/ }).getByRole('button', { name: 'Edit' }).click();
  let dialog = page.getByRole('dialog', { name: 'Edit discipline' });
  await dialog.getByRole('button', { name: 'Add class type' }).click();
  await dialog.getByLabel('Class type 1', { exact: true }).fill('Kids');
  await dialog.getByRole('button', { name: 'Add class type' }).click();
  await dialog.getByLabel('Class type 2', { exact: true }).fill('kids');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('"kids" is listed twice.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove class type 2' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('row', { name: /BJJ/ }).getByRole('cell', { name: 'Kids', exact: true })).toBeVisible();

  // A rung counts "Kids" classes; renaming the type carries onto it.
  await db.rankStripeTier.update({ where: { id: s.rung['White 1'].id }, data: { eligibleClassTypes: ['Kids'] } });
  await page.getByRole('row', { name: /BJJ/ }).getByRole('button', { name: 'Edit' }).click();
  dialog = page.getByRole('dialog', { name: 'Edit discipline' });
  await dialog.getByLabel('Class type 1', { exact: true }).fill('Kids Fundamentals');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('row', { name: /BJJ/ }).getByRole('cell', { name: 'Kids Fundamentals', exact: true })).toBeVisible();
  expect((await db.rankStripeTier.findUniqueOrThrow({ where: { id: s.rung['White 1'].id } })).eligibleClassTypes).toEqual(['Kids Fundamentals']);

  // Removing a type a rung uses is refused, with the reason.
  await page.getByRole('row', { name: /BJJ/ }).getByRole('button', { name: 'Edit' }).click();
  dialog = page.getByRole('dialog', { name: 'Edit discipline' });
  await dialog.getByRole('button', { name: 'Remove class type 1' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText(/"Kids Fundamentals" is still in use \(upcoming classes: 0, timetable slots: 0, rungs on the ladder: 1\)/)).toBeVisible();
});

test('a blank or repeated name is refused', async ({ page }) => {
  await page.goto('/disciplines');
  await page.getByRole('button', { name: 'Add discipline' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add discipline' });
  await dialog.getByLabel('Discipline name').fill('   ');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Enter a name.')).toBeVisible();
  await dialog.getByLabel('Discipline name').fill('bjj');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('A discipline called "bjj" already exists.')).toBeVisible();
});

test('archive a style: it leaves the list, shows under "Show archived", and comes back', async ({ page }) => {
  await page.goto('/disciplines');
  await expect(page.getByRole('row', { name: /BJJ/ }).getByRole('cell', { name: '1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Archive BJJ' }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive BJJ?' });
  await expect(dialog.getByText(/students keep their rank and history/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('row', { name: /BJJ/ })).toHaveCount(0);

  await page.getByLabel('Show archived').check();
  const row = page.getByRole('row', { name: /BJJ/ });
  await expect(row.getByText('Archived', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Edit' })).toHaveCount(0);

  // Read-only while archived.
  await row.getByRole('button', { name: 'Skills and belts of BJJ' }).click();
  await expect(page.getByText(/This style is archived/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add skill' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add belt' })).toHaveCount(0);

  await page.goto('/disciplines');
  await page.getByLabel('Show archived').check();
  await page.getByRole('button', { name: 'Unarchive BJJ' }).click();
  await expect(page.getByRole('row', { name: /BJJ/ }).getByText('Archived', { exact: true })).toHaveCount(0);
  expect((await db.discipline.findUniqueOrThrow({ where: { id: s.disciplineId } })).archivedAt).toBeNull();
});

test('skills show which rungs need them and their lessons; the owner sees who trains the style', async ({ page }) => {
  await page.goto(`/disciplines/${s.disciplineId}`);
  const armbar = page.getByRole('row', { name: /Armbar/ });
  await expect(armbar.getByRole('cell', { name: 'White 2', exact: true })).toBeVisible();
  await expect(armbar.getByRole('cell', { name: '1', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add skill' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add skill' });
  await dialog.getByLabel('Name').fill('Triangle');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('row', { name: /Triangle/ })).toBeVisible();
  await page.getByRole('button', { name: 'Move Triangle up' }).click();
  await expect(page.getByRole('row').nth(1)).toContainText('Triangle');

  await expect(page.getByRole('heading', { name: 'Students (1)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sam Lee' })).toBeVisible();
});

test('a coach sees the Disciplines page read-only', async ({ page }) => {
  const coach = await addPerson('Cara', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await page.context().clearCookies();
  await signIn(page, coach.token);
  await page.goto('/coach');
  await page.getByRole('link', { name: 'Disciplines' }).click();
  await expect(page.getByText('Only the School owner can change them.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add discipline' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Skills and belts of BJJ' }).click();
  await expect(page.getByText('Only the School owner can change this style.')).toBeVisible();
  await expect(page.getByText('White 2').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add skill' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add belt' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Students \(/ })).toHaveCount(0);
});

test('a student\'s rank in an archived style stays visible, read-only (Decision 310)', async ({ page }) => {
  await db.discipline.update({ where: { id: s.disciplineId }, data: { archivedAt: new Date() } });
  await page.goto(`/students/${s.student.id}`);
  const card = page.getByRole('region', { name: 'BJJ' });
  await expect(card.getByText('White 1', { exact: true })).toBeVisible();
  await expect(card.getByText('Archived', { exact: true })).toBeVisible();
  await expect(card.getByText(/This style is archived: the student keeps this rank and history/)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Grade' })).toHaveCount(0);
  await expect(card.getByRole('heading', { name: /Toward/ })).toHaveCount(0);
});

test('a student who left is not counted or listed on the style (Decision 310)', async ({ page }) => {
  const leaver = await addStudent(s, 'Lea', 'Left', { rung: 'White 1' });
  await db.roleGrant.updateMany({ where: { userId: leaver.id, schoolId: s.schoolId }, data: { revokedAt: new Date() } });
  await page.goto(`/disciplines/${s.disciplineId}`);
  await expect(page.getByRole('heading', { name: 'Students (1)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sam Lee' })).toBeVisible();
  await expect(page.getByText('Lea Left')).toHaveCount(0);
  await page.goto('/disciplines');
  await expect(page.getByRole('row', { name: /BJJ/ }).getByRole('cell', { name: '1', exact: true })).toBeVisible();
});

test('the owner lets a Branch Staff member manage disciplines (Decision 383)', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const staff = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  await page.goto('/staff');
  // On the person's Access window (Decision 387).
  await page.getByRole('button', { name: 'Actions for Bea Desk' }).click();
  await page.getByRole('menuitem', { name: 'Access' }).click();
  const dialog = page.getByRole('dialog', { name: 'Access for Bea Desk' });
  const tick = dialog.getByLabel('Manage disciplines');
  await expect(tick).not.toBeChecked();
  await tick.check();
  // The other switch stays off.
  await expect(dialog.getByLabel('Invite coaches')).not.toBeChecked();
  const put = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/access'));
  await dialog.getByRole('button', { name: 'Save' }).click();
  expect((await put).status()).toBe(200);
  // The banner shows once the saved access and the staff lists have reloaded,
  // which can take longer than the default 5 s on a busy CI runner.
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText('Access saved for Bea Desk.')).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await db.staffPermission.findFirst({ where: { userId: staff.id } }))?.canManageDisciplines).toBe(true);

  // Signed in as them (the later sign-in wins), the page is theirs to edit.
  await signIn(page, staff.token);
  await page.goto('/disciplines');
  await expect(page.getByRole('button', { name: 'Add discipline' })).toBeVisible();
  await page.getByRole('row', { name: /BJJ/ }).getByRole('button', { name: 'Skills and belts of BJJ' }).click();
  await expect(page.getByRole('button', { name: 'Add skill' })).toBeVisible();
  await expect(page.getByText('Only the School owner can change them', { exact: false })).toHaveCount(0);
  // They still don't see who trains the style.
  await expect(page.getByRole('heading', { name: /^Students \(/ })).toHaveCount(0);

  // An archived style nobody uses can be deleted permanently.
  await page.goto('/disciplines');
  await page.getByRole('button', { name: 'Add discipline' }).click();
  const add = page.getByRole('dialog', { name: 'Add discipline' });
  await add.getByLabel('Discipline name').fill('Old Karate');
  await add.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Archive Old Karate' }).click();
  await page.getByRole('dialog', { name: 'Archive Old Karate?' }).getByRole('button', { name: 'Archive' }).click();
  await page.getByLabel('Show archived').check();
  const row = page.getByRole('row', { name: /Old Karate/ });
  await expect(row.getByRole('button', { name: 'Delete Old Karate' })).toHaveText('Delete permanently');
  await row.getByRole('button', { name: 'Delete Old Karate' }).click();
  await page.getByRole('dialog', { name: 'Delete Old Karate?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('row', { name: /Old Karate/ })).toHaveCount(0);
  expect(await db.discipline.findFirst({ where: { schoolId: s.schoolId, name: 'Old Karate' } })).toBeNull();
});
