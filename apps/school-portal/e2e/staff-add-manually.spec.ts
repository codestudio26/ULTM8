import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Staff "Add Manually" (Decision 246), against the real API — closes the
 * exact dead end the Staff page's "Invite staff" find-by-email/phone step
 * used to hit when no ULTM8 account existed yet. Mirrors
 * instructors.spec.ts's own "Add Manually" coverage, with one deliberate
 * difference: `branchId` is ALWAYS required here (CreateStaffManuallyDto),
 * not only when the School has branches — so there is no "School with no
 * branches" happy-path variant to cover, only the required-field block.
 *
 * Same "no email provider in test" convention as instructors.spec.ts/
 * coach-invites.spec.ts — the temp-passcode email can't be captured here,
 * so the login -> first-login-passcode-change round trip is covered at the
 * API e2e layer instead (apps/api/test/staff-add-manually.e2e-spec.ts's own
 * "full smoke path" test), not re-tested at this layer.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // a School without branches
});

test.afterAll(async () => {
  await cleanup();
});

test('the owner adds a staff member manually and sees it emailed — picking the Branch first since it is always required', async ({ page }) => {
  const north = await addBranch(s, 'North');
  await signIn(page, s.ownerToken);
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Add staff manually' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add staff manually' });
  await expect(dialog).toBeVisible();

  const email = `new.staff.${randomUUID()}@example.test`;
  await dialog.getByLabel('First name').fill('New');
  await dialog.getByLabel('Surname').fill('Staffer');
  await dialog.getByLabel('Email', { exact: false }).fill(email);
  await dialog.getByLabel('Branch').selectOption({ label: 'North' });
  await dialog.getByRole('button', { name: 'Add staff' }).click();

  // No email provider in the test environment: the record is still created, with a warning.
  await expect(page.getByText(/was added, but the email couldn't be sent/)).toBeVisible();

  const created = await db.user.findFirstOrThrow({ where: { email } });
  expect(created.mustChangePasscode).toBe(true);
  expect(created.phone).toBeNull();
  expect(created.dateOfBirth).toBeNull();
  const grant = await db.roleGrant.findFirst({ where: { userId: created.id, schoolId: s.schoolId, role: 'BRANCH_STAFF' } });
  expect(grant).not.toBeNull();
  expect(grant?.branchId).toBe(north.id);
});

test('branchId is always required — the native required Branch field blocks submission with nothing created', async ({ page }) => {
  await addBranch(s, 'South');
  await signIn(page, s.ownerToken);
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Add staff manually' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add staff manually' });
  const email = `needs.branch.${randomUUID()}@example.test`;
  await dialog.getByLabel('First name').fill('Needs');
  await dialog.getByLabel('Surname').fill('Branch');
  await dialog.getByLabel('Email', { exact: false }).fill(email);
  await dialog.getByRole('button', { name: 'Add staff' }).click();
  // The Branch <select> is a native `required` field — the browser blocks
  // submission on its own before React's onSubmit ever runs, so the modal
  // stays open with nothing created, same regression class
  // instructors.spec.ts's own branch test already covers.
  await expect(dialog).toBeVisible();
  await expect(db.user.findFirst({ where: { email } })).resolves.toBeNull();

  await dialog.getByLabel('Branch').selectOption({ label: 'South' });
  await dialog.getByRole('button', { name: 'Add staff' }).click();
  await expect(page.getByText(/was added/)).toBeVisible();
});

test('a duplicate email is rejected with a clear message, no second account created', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const existing = await addPerson('Already', 'Exists', [{ role: 'STUDENT', schoolId: s.schoolId }]);
  await signIn(page, s.ownerToken);
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Add staff manually' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add staff manually' });
  await dialog.getByLabel('First name').fill('Dup');
  await dialog.getByLabel('Surname').fill('Email');
  await dialog.getByLabel('Email', { exact: false }).fill(existing.email);
  await dialog.getByLabel('Branch').selectOption({ label: 'North' });
  await dialog.getByRole('button', { name: 'Add staff' }).click();
  await expect(page.getByText(/already exists/)).toBeVisible();

  const users = await db.user.findMany({ where: { email: existing.email } });
  expect(users).toHaveLength(1);
});
