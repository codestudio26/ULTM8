import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Student grading panel (roadmap Phase 4, item 2), against the real API:
 * rank, progress and skills; skill sign-off; grading with the skill
 * acknowledgement; moving down; voiding; a first rank; keyboard-only use.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

const bjj = (page: Page) => page.getByRole('region', { name: 'BJJ' });

test('the Students list opens a student\'s grading panel', async ({ page }) => {
  await page.goto('/students');
  await page.getByRole('link', { name: s.student.name }).click();
  await expect(page).toHaveURL(new RegExp(`/students/${s.student.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: s.student.name })).toBeVisible();
});

test('shows the current rank, progress toward the next rank and the skills for it', async ({ page }) => {
  await page.goto(`/students/${s.student.id}`);
  const card = bjj(page);
  await expect(card.getByText('White 1', { exact: true })).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Toward White 2 — 100%' })).toBeVisible();
  await expect(card.getByText('Classes: 3 of 3')).toBeVisible();
  await expect(card.getByText('Skills: 0 of 1 signed off')).toBeVisible();
  await expect(card.getByRole('link', { name: 'Armbar from guard' })).toBeVisible();
  await expect(card.getByText('Ready to grade')).toHaveCount(0);
});

test('signing off the last skill makes the student ready to grade', async ({ page }) => {
  await page.goto(`/students/${s.student.id}`);
  const card = bjj(page);
  await card.getByRole('button', { name: 'Armbar: Not started. Change to Learning' }).click();
  await card.getByRole('button', { name: 'Armbar: Learning. Change to Signed off' }).click();
  await expect(card.getByRole('button', { name: 'Armbar: Signed off. Change to Not started' })).toBeVisible();
  await expect(card.getByText('Skills: 1 of 1 signed off')).toBeVisible();
  await expect(card.getByText('Ready to grade')).toBeVisible();
});

test('grading without the skill needs the acknowledgement, and is recorded', async ({ page }) => {
  // Only active students are graded up (Decision 283): Sam has no membership, so switch him on.
  const { db } = await import('./fixtures');
  await db.studentRank.updateMany({ where: { studentId: s.student.id }, data: { boardActiveOverride: true } });
  await page.goto(`/students/${s.student.id}`);
  const card = bjj(page);
  await card.getByRole('button', { name: 'Grade' }).click();
  const dialog = page.getByRole('dialog', { name: 'Grade — BJJ' });
  await expect(dialog.getByLabel('New rank')).toHaveText(/White 2/);
  const submit = dialog.getByRole('button', { name: 'Award stripe' });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel(/Grade without all skills signed off/).check();
  await dialog.getByLabel('Note').fill('Great roll today');
  await submit.click();
  await expect(dialog).toBeHidden();

  await expect(card.getByText('White 2', { exact: true })).toBeVisible();
  const history = card.getByRole('list').last();
  await expect(history.getByText('Stripe awarded')).toBeVisible();
  await expect(history.getByText('White 1 → White 2')).toBeVisible();
  await expect(history.getByText('Graded without all skills signed off (acknowledged).')).toBeVisible();
  await expect(history.getByText('Note: Great roll today')).toBeVisible();
});

test('an inactive student can\'t be graded up, and the dialog says why (Decision 283)', async ({ page }) => {
  await page.goto(`/students/${s.student.id}`);
  await bjj(page).getByRole('button', { name: 'Grade' }).click();
  const dialog = page.getByRole('dialog', { name: 'Grade — BJJ' });
  await dialog.getByLabel(/Grade without all skills signed off/).check();
  await dialog.getByRole('button', { name: 'Award stripe' }).click();
  await expect(dialog.getByText(/Only active students can be graded/)).toBeVisible();
});

test('a style that requires skills blocks grading until they are signed off', async ({ page }) => {
  const { db } = await import('./fixtures');
  await db.discipline.update({ where: { id: s.disciplineId }, data: { skillsRequiredToGrade: true } });
  await page.goto(`/students/${s.student.id}`);
  await bjj(page).getByRole('button', { name: 'Grade' }).click();
  const dialog = page.getByRole('dialog', { name: 'Grade — BJJ' });
  await expect(dialog.getByText(/requires every skill for the next rank to be signed off/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Award stripe' })).toBeDisabled();
});

test('moving down needs a reason; a voided entry is hidden unless asked for', async ({ page }) => {
  await page.goto(`/students/${s.student.id}`);
  const card = bjj(page);
  await card.getByRole('button', { name: 'Move down' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move down — BJJ' });
  const submit = dialog.getByRole('button', { name: 'Move down' });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('Reason').fill('Missed the basics');
  await submit.click();
  await expect(dialog).toBeHidden();
  await expect(card.getByText('White 0', { exact: true })).toBeVisible();
  await expect(card.getByText('Reason: Missed the basics')).toBeVisible();

  await card.getByRole('button', { name: /^Void entry: Moved down/ }).click();
  const voidDialog = page.getByRole('dialog', { name: 'Void history entry' });
  await voidDialog.getByLabel('Reason').fill('Entered by mistake');
  await voidDialog.getByRole('button', { name: 'Void entry' }).click();
  await expect(voidDialog).toBeHidden();
  await expect(card.getByText('Reason: Missed the basics')).toHaveCount(0);

  await page.getByLabel('Show voided history entries').check();
  await expect(card.getByText('Voided', { exact: true })).toBeVisible();
  await expect(card.getByText(/by You: Entered by mistake/)).toBeVisible();
});

test('a student with no rank gets a first rank', async ({ page }) => {
  await page.goto(`/students/${s.newStudent.id}`);
  const card = bjj(page);
  await expect(card.getByText('No rank in this style yet.')).toBeVisible();
  await card.getByRole('button', { name: 'Give first rank' }).click();
  const dialog = page.getByRole('dialog', { name: 'Give a first rank — BJJ' });
  await expect(dialog.getByLabel('New rank')).toHaveText(/White 0/);
  await dialog.getByRole('button', { name: 'Grade' }).click();
  await expect(dialog).toBeHidden();
  await expect(card.getByText('White 0', { exact: true })).toBeVisible();
  await expect(card.getByText('Promoted', { exact: true })).toBeVisible();
});

test('works with the keyboard only', async ({ page }) => {
  await page.goto(`/students/${s.newStudent.id}`);
  const card = bjj(page);
  await expect(card.getByRole('button', { name: 'Give first rank' })).toBeVisible();

  // Tab to the button, open the form with Enter, fill it and submit.
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    if (await card.getByRole('button', { name: 'Give first rank' }).evaluate((el) => el === document.activeElement)) break;
  }
  await expect(card.getByRole('button', { name: 'Give first rank' })).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Give a first rank — BJJ' });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    if (await dialog.getByLabel('Note').evaluate((el) => el === document.activeElement)) break;
  }
  await page.keyboard.type('Keyboard grade');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Grade' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(card.getByText('Note: Keyboard grade')).toBeVisible();
});

// ---------------------------------------------------------------------------
// v1.2 backend backlog — Student Detail's "Upcoming Booking" and
// "Revoke Enrollment", both wired onto this same real page (no separate
// mockup-matching Student Detail page exists in this app).
// ---------------------------------------------------------------------------

test('shows the student\'s upcoming Booking', async ({ page }) => {
  const cls = await db.class.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      title: 'Open Mat',
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
    await page.goto(`/students/${s.student.id}`);
    const panel = page.getByRole('heading', { name: 'Upcoming Booking' }).locator('..');
    await expect(panel.getByText('Open Mat')).toBeVisible();
  } finally {
    await db.booking.delete({ where: { id: booking.id } });
    await db.membership.delete({ where: { id: membership.id } });
    await db.membershipPlan.delete({ where: { id: plan.id } });
    await db.class.delete({ where: { id: cls.id } });
  }
});

test('shows "No upcoming Booking" when the student has none', async ({ page }) => {
  await page.goto(`/students/${s.newStudent.id}`);
  const panel = page.getByRole('heading', { name: 'Upcoming Booking' }).locator('..');
  await expect(panel.getByText('No upcoming Booking.')).toBeVisible();
});

test('the owner revokes a student\'s enrollment', async ({ page }) => {
  await page.goto(`/students/${s.newStudent.id}`);
  await page.getByRole('button', { name: 'Revoke enrollment' }).click();
  const dialog = page.getByRole('dialog', { name: `Revoke ${s.newStudent.name}'s enrollment?` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Revoke' }).click();

  await expect(page).toHaveURL(/\/students$/);
  const grant = await db.roleGrant.findFirstOrThrow({ where: { userId: s.newStudent.id, schoolId: s.schoolId, role: 'STUDENT' } });
  expect(grant.revokedAt).not.toBeNull();
});

// ---------------------------------------------------------------------------
// v1.2 backend backlog — `StudentUpdate.dc.html`: a Staff member editing a
// Student's own profile on their behalf, on its own dedicated page (reached
// from this page's "Edit profile" button), not a Modal over this page.
// ---------------------------------------------------------------------------

test('the owner edits a student\'s profile on their behalf, on the dedicated Update page', async ({ page }) => {
  await page.goto(`/students/${s.newStudent.id}`);
  await page.getByRole('button', { name: 'Edit profile' }).click();
  await expect(page).toHaveURL(new RegExp(`/students/${s.newStudent.id}/edit$`));
  await expect(page.getByRole('heading', { level: 1, name: `Edit ${s.newStudent.name}'s profile` })).toBeVisible();
  // Pre-filled from the roster's own known fields.
  await expect(page.getByLabel('First name')).toHaveValue('Nia');
  await expect(page.getByLabel('Surname')).toHaveValue('Park');
  // No email/phone field exists on this form at all.
  await expect(page.getByLabel('Email')).toHaveCount(0);
  await expect(page.getByLabel('Phone')).toHaveCount(0);

  await page.getByLabel('Surname').fill('Park-Smith');
  // Decision 276 — country first; the UK form asks for a post town and postcode.
  await page.getByLabel('Country').selectOption('GB');
  await page.getByLabel('Address line 1').fill('221B Dojo Lane');
  await page.getByLabel('Town/City').fill('London');
  await page.getByLabel('Postcode').fill('nw1 6xe');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();

  await page.getByRole('button', { name: /^Back to/ }).click();
  await expect(page).toHaveURL(new RegExp(`/students/${s.newStudent.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Nia Park-Smith' })).toBeVisible();
  const user = await db.user.findUniqueOrThrow({ where: { id: s.newStudent.id } });
  expect(user.surname).toBe('Park-Smith');
  expect(user.address).toBe('221B Dojo Lane, London, NW1 6XE, United Kingdom');
  expect(user.addressCountry).toBe('GB');
  expect(user.addressPostalCode).toBe('NW1 6XE');
});

test('a coach (non-Owner Staff) can also edit a student\'s profile', async ({ page }) => {
  // Plain INSTRUCTOR RoleGrant, no grading permission at all — Edit profile is
  // gated by the backend's assertStaffAtSchool (any Staff role), not by
  // per-discipline grading permissions, so it must still show.
  const coach = await addPerson('Cora', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await signIn(page, coach.token);
  await page.goto(`/students/${s.student.id}`);
  await page.getByRole('button', { name: 'Edit profile' }).click();
  await expect(page).toHaveURL(new RegExp(`/students/${s.student.id}/edit$`));
  await page.getByLabel('Gender').fill('Non-binary');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();

  const user = await db.user.findUniqueOrThrow({ where: { id: s.student.id } });
  expect(user.gender).toBe('Non-binary');
});
