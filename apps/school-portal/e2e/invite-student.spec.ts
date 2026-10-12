import { expect, test } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Invite a Student (v1.2 backend backlog), against the real API: the owner
 * finds an existing, already-registered person by email and enrolls them —
 * the same find-then-confirm pattern coach-invites.spec.ts's own Staff page
 * exercises for Instructor/Branch Staff. Deliberately scoped to someone who
 * already has a ULTM8 account (SchoolsService.join()'s Staff-on-behalf-of
 * branch) — there is no "add a brand-new person" path on this page; see
 * this feature's own PR description for the product question that leaves.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // a School without branches; Sam Lee already enrolled
});

test.afterAll(async () => {
  await cleanup();
});

test('the owner finds an existing person by email and enrolls them as a Student', async ({ page }) => {
  const newPerson = await addPerson('Riley', 'Newcomer'); // a real account, not yet enrolled anywhere

  await signIn(page, s.ownerToken);
  await page.goto('/students');
  await page.getByRole('button', { name: 'Invite a Student' }).click();
  await expect(page).toHaveURL(/\/students\/invite$/);

  await page.getByLabel('Email').fill(newPerson.email);
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.getByText('Found Riley Newcomer')).toBeVisible();

  await page.getByRole('button', { name: 'Enroll' }).click();
  await expect(page.getByText('Enrolled.')).toBeVisible();

  const grant = await db.roleGrant.findFirst({ where: { userId: newPerson.id, schoolId: s.schoolId, role: 'STUDENT' } });
  expect(grant).not.toBeNull();
  expect(grant!.grantedById).toBe(s.ownerId);

  await page.getByRole('button', { name: 'Back to Students' }).click();
  await expect(page).toHaveURL(/\/students$/);
  await expect(page.getByRole('row', { name: /Riley Newcomer/ })).toBeVisible();
});

test('no account found with that email shows an error, not a silent failure', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/students/invite');
  await page.getByLabel('Email').fill('nobody-at-all@example.test');
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.getByText('No ULTM8 account found with that email or phone.')).toBeVisible();
});

test('enrolling someone already enrolled surfaces the conflict', async ({ page }) => {
  // s.student (Sam Lee) is already enrolled by seedGradingSchool() — reuse an
  // account that is real but not yet registered as the account first, then
  // enroll it twice to hit the same conflict path without relying on Sam
  // Lee's own email being memorable to type into the form.
  const already = await addPerson('Already', 'Enrolled', [{ role: 'STUDENT', schoolId: s.schoolId }]);

  await signIn(page, s.ownerToken);
  await page.goto('/students/invite');
  await page.getByLabel('Email').fill(already.email);
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.getByText('Found Already Enrolled')).toBeVisible();
  await page.getByRole('button', { name: 'Enroll' }).click();
  await expect(page.getByText('This Student is already enrolled at this School.')).toBeVisible();
});

test('a School with branches requires choosing the new Student\'s home branch', async ({ page }) => {
  await addBranch(s, 'North');
  const newPerson = await addPerson('Jordan', 'Fresh');

  await signIn(page, s.ownerToken);
  await page.goto('/students/invite');
  await page.getByLabel('Email').fill(newPerson.email);
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.getByText('Found Jordan Fresh')).toBeVisible();

  // No branch chosen yet — refused client-side before any request fires.
  await page.getByRole('button', { name: 'Enroll' }).click();
  await expect(page.getByText('Select this Student\'s home branch.')).toBeVisible();

  await page.getByLabel('Home branch').selectOption({ label: 'North' });
  await page.getByRole('button', { name: 'Enroll' }).click();
  await expect(page.getByText('Enrolled.')).toBeVisible();

  const home = await db.studentHomeBranch.findFirst({ where: { studentId: newPerson.id, schoolId: s.schoolId } });
  expect(home).not.toBeNull();
});
