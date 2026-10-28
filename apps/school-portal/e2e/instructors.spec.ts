import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addBranch, addCoach, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

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
  // The Branch <select> is a native `required` field — the browser blocks
  // submission on its own before React's onSubmit ever runs, so the modal
  // stays open with nothing created, rather than any particular message text.
  await expect(page.getByRole('dialog', { name: 'Add instructor manually' })).toBeVisible();

  await page.getByRole('dialog').getByLabel('Branch').selectOption({ label: 'North' });
  await page.getByRole('button', { name: 'Add instructor' }).last().click();
  await expect(page.getByText(/was added/)).toBeVisible();
});

// ---------------------------------------------------------------------------
// "Invite to Instructor Role" — distinct from "Add manually" above: the
// target already has a ULTM8 account (e.g. as a Student), found by exact
// email/phone match, and only the INSTRUCTOR RoleGrant is created (no new
// User, and no Instructor profile yet — that's still a separate "Add
// instructor" step, same two-step shape StaffPage's own invite flow and
// InstructorsService.create()'s header comment both already establish).
// ---------------------------------------------------------------------------

test('the owner invites an existing eligible user (already a Student) to the Instructor role', async ({ page }) => {
  const existing = await addPerson('Already', 'AStudent', [{ role: 'STUDENT', schoolId: s.schoolId }]);
  await signIn(page, s.ownerToken);
  await page.goto('/instructors');
  await page.getByRole('button', { name: 'Invite existing user' }).click();
  await expect(page.getByRole('dialog', { name: 'Invite to Instructor role' })).toBeVisible();
  await page.getByLabel('Email').fill(existing.email);
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.getByText(`Found Already AStudent (${existing.email}).`)).toBeVisible();
  await page.getByRole('button', { name: 'Grant Instructor role' }).click();

  // No email provider in the test environment: the grant is still made, with
  // a warning — same convention coach-invites.spec.ts/this file's own "Add
  // Manually" test already establish.
  await expect(page.getByText(/the notification email could not be sent/)).toBeVisible();

  const grant = await db.roleGrant.findFirst({ where: { userId: existing.id, schoolId: s.schoolId, role: 'INSTRUCTOR', revokedAt: null } });
  expect(grant).not.toBeNull();
  // Their existing STUDENT role is kept, not replaced (RoleGrant allows more
  // than one role per User — domain-rules §3).
  const roles = (await db.roleGrant.findMany({ where: { userId: existing.id, revokedAt: null } })).map((g) => g.role).sort();
  expect(roles).toEqual(['INSTRUCTOR', 'STUDENT']);

  // The role grant and the Instructor profile are deliberately separate steps
  // (see InstructorsService.create()'s own header comment); "Add instructor"
  // opens next with them already picked (Decision 312).
  const add = page.getByRole('dialog', { name: /Add instructor/i });
  await expect(add.getByLabel('User')).toHaveValue(existing.id);
  await expect(add.getByLabel('User')).toContainText(`Already AStudent (${existing.email})`);
});

test('no existing account is found by email/phone — a clear message, no grant created', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/instructors');
  await page.getByRole('button', { name: 'Invite existing user' }).click();
  await page.getByLabel('Email').fill(`nobody.${randomUUID()}@example.test`);
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.getByText('No ULTM8 account found with that email or phone.')).toBeVisible();
  // Still on the search form — no "Grant Instructor role" step to even reach.
  await expect(page.getByRole('button', { name: 'Find' })).toBeVisible();
});

test('a School with branches requires one before granting the Instructor role will submit', async ({ page }) => {
  await addBranch(s, 'North');
  const existing = await addPerson('Needs', 'Branch', [{ role: 'STUDENT', schoolId: s.schoolId }]);
  await signIn(page, s.ownerToken);
  await page.goto('/instructors');
  await page.getByRole('button', { name: 'Invite existing user' }).click();
  await page.getByLabel('Email').fill(existing.email);
  await page.getByRole('button', { name: 'Find' }).click();
  await page.getByRole('button', { name: 'Grant Instructor role' }).click();
  // The Branch <select> is a native `required` field — submission is blocked
  // client-side, same regression class the "Add Manually" branch test above
  // already covers.
  await expect(page.getByRole('dialog', { name: 'Invite to Instructor role' })).toBeVisible();
  await expect(
    db.roleGrant.findFirst({ where: { userId: existing.id, schoolId: s.schoolId, role: 'INSTRUCTOR' } }),
  ).resolves.toBeNull();

  await page.getByRole('dialog').getByLabel('Branch').selectOption({ label: 'North' });
  await page.getByRole('button', { name: 'Grant Instructor role' }).click();
  await expect(page.getByText(/Instructor role granted/)).toBeVisible();
  const grant = await db.roleGrant.findFirst({ where: { userId: existing.id, schoolId: s.schoolId, role: 'INSTRUCTOR' } });
  expect(grant?.branchId).toBeDefined();
});

test("an Instructor completes their own profile's deferred fields", async ({ page }) => {
  const coach = await addPerson('Deferred', 'Fields', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await db.instructor.create({ data: { id: randomUUID(), userId: coach.id, schoolId: s.schoolId } });
  await signIn(page, coach.token);
  await page.goto('/complete-instructor-profile');
  await page.getByLabel('Country', { exact: true }).selectOption('GB');
  await page.getByLabel('Address line 1').fill('123 Mat Street');
  // A UK address needs a postcode: the form says so before anything is sent.
  await page.getByLabel('Town/City').fill('Leeds');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Postcode is required.')).toBeVisible();
  await page.getByLabel('Postcode').fill('LS1 4AP');
  await page.getByLabel('Activities', { exact: false }).fill('BJJ, Judo');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Your profile was updated.')).toBeVisible();

  const updated = await db.instructor.findFirstOrThrow({ where: { userId: coach.id, schoolId: s.schoolId } });
  expect(updated.address).toBe('123 Mat Street, Leeds, LS1 4AP, United Kingdom');
  expect(updated.addressCity).toBe('Leeds');
  expect(updated.activities).toEqual(['BJJ', 'Judo']);
});

// ---------------------------------------------------------------------------
// v1.2 backend backlog — Instructor Detail (new page): the real "Instructor
// Class" grid (server-computed enrolledCount) and "Revoke Enrollment".
// ---------------------------------------------------------------------------

test('Instructor Detail shows the Instructor\'s own Classes with a real enrolled count, and the owner can revoke enrollment', async ({ page }) => {
  await signIn(page, s.ownerToken);
  const coach = await addCoach(s, 'Dana', 'Coach');
  const profile = await db.instructor.create({ data: { id: randomUUID(), userId: coach.id, schoolId: s.schoolId } });

  const cls = await db.class.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      instructorId: coach.id, // Class.instructorId is a User.id FK, not Instructor.id
      title: 'Taught by Dana',
      startDate: new Date(Date.now() + 24 * 3_600_000),
      endDate: new Date(Date.now() + 25 * 3_600_000),
    },
  });
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 },
  });
  const membership = await db.membership.create({
    data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: plan.id, schoolId: s.schoolId, status: 'ACTIVE', frequency: 'RECURRING' },
  });
  const booking = await db.booking.create({
    data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: membership.id, status: 'UPCOMING' },
  });

  try {
    await page.goto('/instructors');
    const row = page.getByRole('row', { name: /Dana Coach/ });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'View' }).click();
    await expect(page).toHaveURL(new RegExp(`/instructors/${profile.id}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Dana Coach' })).toBeVisible();
    await expect(page.getByText('Taught by Dana')).toBeVisible();
    // No capacity set on this fixture Class, so the badge reads "1  booked"
    // (enrolledCount, no "/<capacity>" segment — see InstructorDetailPage's
    // own render).
    await expect(page.getByText(/^1\s+booked$/)).toBeVisible();

    // Still teaching an upcoming class: revoking is refused (Decision 331).
    await page.getByRole('button', { name: 'Revoke enrollment' }).click();
    const blocked = page.getByRole('dialog', { name: 'Dana Coach still teaches classes' });
    await expect(blocked).toBeVisible();
    await blocked.getByRole('button', { name: 'Cancel' }).click();

    // Once the class is over, it goes through.
    await db.class.update({ where: { id: cls.id }, data: { startDate: new Date(Date.now() - 25 * 3_600_000), endDate: new Date(Date.now() - 24 * 3_600_000) } });
    await page.reload();
    await page.getByRole('button', { name: 'Revoke enrollment' }).click();
    const dialog = page.getByRole('dialog', { name: 'Revoke Dana Coach\'s enrollment?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Revoke' }).click();

    await expect(page).toHaveURL(/\/instructors$/);
    const grant = await db.roleGrant.findFirstOrThrow({ where: { userId: coach.id, schoolId: s.schoolId, role: 'INSTRUCTOR' } });
    expect(grant.revokedAt).not.toBeNull();
  } finally {
    await db.booking.delete({ where: { id: booking.id } });
    await db.membership.delete({ where: { id: membership.id } });
    await db.membershipPlan.delete({ where: { id: plan.id } });
    await db.class.delete({ where: { id: cls.id } });
    await db.instructor.delete({ where: { id: profile.id } });
  }
});
