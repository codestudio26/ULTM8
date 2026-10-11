import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Instructor "Add Manually" (Decision 1/230/237) and self-service profile
 * completion (Decision 1/217), against the real API — same "no email
 * provider in test" convention coach-invites.spec.ts already established
 * (the temp-passcode email can't be captured here, so the login ->
 * first-login-passcode-change round trip is covered at the API e2e layer
 * instead, apps/api/test/instructors.e2e-spec.ts's own "full smoke path"
 * test — not re-tested at this layer).
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // a School without branches
});

test.afterAll(async () => {
  await cleanup();
});

test('the owner adds an instructor manually and sees it in the roster', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/instructors');
  await page.getByRole('button', { name: 'Add manually' }).click();
  const email = `new.coach.${randomUUID()}@example.test`;
  await page.getByLabel('First name').fill('New');
  await page.getByLabel('Surname').fill('Coach');
  await page.getByLabel('Email', { exact: false }).fill(email);
  await page.getByRole('button', { name: 'Add instructor' }).last().click();

  // No email provider in the test environment: the record is still created, with a warning.
  await expect(page.getByText(/was added, but the email couldn't be sent/)).toBeVisible();
  await expect(page.getByRole('row', { name: /New Coach/ })).toBeVisible();

  const created = await db.user.findFirstOrThrow({ where: { email } });
  expect(created.mustChangePasscode).toBe(true);
  expect(created.phone).toBeNull();
  const grant = await db.roleGrant.findFirst({ where: { userId: created.id, schoolId: s.schoolId, role: 'INSTRUCTOR' } });
  expect(grant).not.toBeNull();
});

test('a School with branches requires one before Add Manually will submit', async ({ page }) => {
  await addBranch(s, 'North');
  await signIn(page, s.ownerToken);
  await page.goto('/instructors');
  await page.getByRole('button', { name: 'Add manually' }).click();
  await page.getByLabel('First name').fill('Needs');
  await page.getByLabel('Surname').fill('Branch');
  await page.getByLabel('Email', { exact: false }).fill(`needs.branch.${randomUUID()}@example.test`);
  await page.getByRole('button', { name: 'Add instructor' }).last().click();
  await expect(page.getByText('Choose the branch this instructor belongs to.')).toBeVisible();

  await page.getByLabel('Branch').selectOption({ label: 'North' });
  await page.getByRole('button', { name: 'Add instructor' }).last().click();
  await expect(page.getByText(/was added/)).toBeVisible();
});

test("an Instructor completes their own profile's deferred fields", async ({ page }) => {
  const coach = await addPerson('Deferred', 'Fields', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await db.instructor.create({ data: { id: randomUUID(), userId: coach.id, schoolId: s.schoolId } });
  await signIn(page, coach.token);
  await page.goto('/complete-instructor-profile');
  await page.getByLabel('Address').fill('123 Mat Street');
  await page.getByLabel('Activities', { exact: false }).fill('BJJ, Judo');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Your profile was updated.')).toBeVisible();

  const updated = await db.instructor.findFirstOrThrow({ where: { userId: coach.id, schoolId: s.schoolId } });
  expect(updated.address).toBe('123 Mat Street');
  expect(updated.activities).toEqual(['BJJ', 'Judo']);
});
