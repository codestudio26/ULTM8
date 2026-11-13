import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 168 (reused for Students by Decision 341): in a School with
 * branches, staff see only the students of the branches they are assigned
 * to, so a coach whose role has no branch sees none. The rule stays; the
 * list tells them why instead of saying "No Students yet". Such a coach only
 * exists if the role was given before the School added its first branch
 * (Decision 169).
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // Sam Lee (s.student) and Nia Park (s.newStudent)
});

test.afterAll(async () => {
  await cleanup();
});

const NO_BRANCH_TITLE = "You aren't assigned to a branch yet";
const NO_BRANCH_LINE = "You see the students of the branches you're assigned to. The School owner can assign you to a branch.";

test('a coach with no branch, in a School with branches, is told why the list is empty', async ({ page }) => {
  const north = await addBranch(s, 'North');
  await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, branchId: north.id } });
  const coach = await addPerson('Cora', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await signIn(page, coach.token);
  await page.goto('/students');
  await expect(page.getByText(NO_BRANCH_TITLE)).toBeVisible();
  await expect(page.getByText(NO_BRANCH_LINE)).toBeVisible();
  await expect(page.getByText('No Students yet')).toHaveCount(0);
  // Who they may see is unchanged: still nobody.
  await expect(page.getByRole('button', { name: 'Sam Lee', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nia Park', exact: true })).toHaveCount(0);
});

test('a coach with a branch, and the owner, see their lists as before', async ({ page, browser, baseURL }) => {
  const north = await addBranch(s, 'North');
  await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, branchId: north.id } });
  const coach = await addPerson('Cora', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId, branchId: north.id }]);
  await signIn(page, coach.token);
  await page.goto('/students');
  await expect(page.getByRole('button', { name: 'Sam Lee', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nia Park', exact: true })).toHaveCount(0);
  await expect(page.getByText(NO_BRANCH_TITLE)).toHaveCount(0);

  const ownerContext = await browser.newContext({ baseURL });
  const owner = await ownerContext.newPage();
  await signIn(owner, s.ownerToken);
  await owner.goto('/students');
  await expect(owner.getByRole('button', { name: 'Sam Lee', exact: true })).toBeVisible();
  await expect(owner.getByRole('button', { name: 'Nia Park', exact: true })).toBeVisible();
  await expect(owner.getByText(NO_BRANCH_TITLE)).toHaveCount(0);
  await ownerContext.close();
});

test('a coach with a branch whose branch has no students still sees "No Students yet"', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const coach = await addPerson('Cora', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId, branchId: north.id }]);
  await signIn(page, coach.token);
  await page.goto('/students');
  await expect(page.getByText('No Students yet')).toBeVisible();
  await expect(page.getByText(NO_BRANCH_TITLE)).toHaveCount(0);
});

test('in a School with no branches, a coach with no branch sees every student as before', async ({ page }) => {
  const coach = await addPerson('Cora', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await signIn(page, coach.token);
  await page.goto('/students');
  await expect(page.getByRole('button', { name: 'Sam Lee', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nia Park', exact: true })).toBeVisible();
  await expect(page.getByText(NO_BRANCH_TITLE)).toHaveCount(0);
});

test('Branch Staff with a no-branch role (old data; a branch is required today) get the same note', async ({ page }) => {
  const north = await addBranch(s, 'North');
  await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, branchId: north.id } });
  const staff = await addPerson('Bo', 'Branch', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId }]);
  await signIn(page, staff.token);
  await page.goto('/students');
  await expect(page.getByText(NO_BRANCH_TITLE)).toBeVisible();
  await expect(page.getByText('No Students yet')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sam Lee', exact: true })).toHaveCount(0);
});
