import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Students page review fixes (Decision 341), in a real browser against the
 * real API: the edit form opens filled in, Language and Currency are lists,
 * a Guardian-managed child shows no placeholder email, a former student's
 * page, the real next booking, and coaches typing an owner-only address.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

test('the edit form opens with the saved profile, and emptying a field clears it', async ({ page }) => {
  await db.user.update({ where: { id: s.newStudent.id }, data: { nationality: 'Brazilian', kimonoSize: 'A2', language: 'pt-BR', currency: 'BRL' } });
  await page.goto(`/students/${s.newStudent.id}/edit`);
  await expect(page.getByLabel('Nationality')).toHaveValue('Brazilian');
  await expect(page.getByLabel('Kimono size')).toHaveValue('A2');
  await expect(page.getByLabel('Date of birth')).toHaveValue('2000-01-01');
  await expect(page.locator('#student-update-language')).toHaveValue('pt-BR');

  await page.getByLabel('Nationality').fill('');
  await page.locator('#student-update-language').selectOption('es');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();

  const user = await db.user.findUniqueOrThrow({ where: { id: s.newStudent.id } });
  expect(user.nationality).toBeNull();
  expect(user.language).toBe('es');
  // Untouched fields are left as they were.
  expect(user.kimonoSize).toBe('A2');
  expect(user.currency).toBe('BRL');
});

test('an impossible date of birth is refused with a clear message', async ({ page }) => {
  await page.goto(`/students/${s.newStudent.id}/edit`);
  await page.getByLabel('Date of birth').fill('2099-01-01');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Enter a real date of birth: not in the future and not more than 120 years ago.')).toBeVisible();
  expect((await db.user.findUniqueOrThrow({ where: { id: s.newStudent.id } })).dateOfBirth?.toISOString().slice(0, 10)).toBe('2000-01-01');
});

test('a Guardian-managed child shows "Managed by a Guardian", not a placeholder email', async ({ page }) => {
  await db.user.update({ where: { id: s.newStudent.id }, data: { email: `minor+${randomUUID()}@guardian-managed.ultm8.internal` } });
  await page.goto('/students');
  const row = page.getByRole('row', { name: /Nia Park/ });
  await expect(row.getByText('Managed by a Guardian')).toBeVisible();
  await expect(page.getByText('guardian-managed.ultm8.internal')).toHaveCount(0);
});

test('a former student\'s page shows their name and an Inactive badge, with nothing to change', async ({ page }) => {
  await db.roleGrant.updateMany({ where: { userId: s.student.id, schoolId: s.schoolId, role: 'STUDENT' }, data: { revokedAt: new Date() } });
  await page.goto(`/students/${s.student.id}`);
  await expect(page.getByRole('heading', { level: 1, name: s.student.name })).toBeVisible();
  await expect(page.getByText('Inactive', { exact: true })).toBeVisible();
  const card = page.getByRole('region', { name: 'BJJ' });
  await expect(card.getByText('White 1', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Grade' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: /Armbar: .* Change to/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit profile' })).toHaveCount(0);
});

test('"Upcoming Booking" is the soonest class, even with more than 20 bookings', async ({ page }) => {
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
  const membership = await db.membership.create({
    data: { id: randomUUID(), studentId: s.newStudent.id, membershipPlanId: plan.id, schoolId: s.schoolId, status: 'ACTIVE', frequency: 'RECURRING' },
  });
  // The soonest class gets the highest booking id, so id order puts it last.
  const hours = Array.from({ length: 25 }, (_, i) => 200 - i * 4);
  const ids = hours.map(() => randomUUID()).sort();
  const classIds: string[] = [];
  try {
    for (const [i, h] of hours.entries()) {
      const cls = await db.class.create({
        data: { id: randomUUID(), schoolId: s.schoolId, title: `Class ${h}h`, startDate: new Date(Date.now() + h * 3_600_000), endDate: new Date(Date.now() + (h + 1) * 3_600_000) },
      });
      classIds.push(cls.id);
      await db.booking.create({ data: { id: ids[i], studentId: s.newStudent.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: membership.id } });
    }
    await page.goto(`/students/${s.newStudent.id}`);
    const panel = page.getByRole('heading', { name: 'Upcoming Booking' }).locator('..');
    await expect(panel.getByText('Class 104h')).toBeVisible();
    await expect(panel.getByText('+24 more')).toBeVisible();
  } finally {
    await db.booking.deleteMany({ where: { studentId: s.newStudent.id } });
    await db.membership.delete({ where: { id: membership.id } });
    await db.membershipPlan.delete({ where: { id: plan.id } });
    await db.class.deleteMany({ where: { id: { in: classIds } } });
  }
});

test('a coach typing /students or /students/invite lands on their own home screen', async ({ page }) => {
  const coach = await addPerson('Cleo', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await signIn(page, coach.token);
  for (const path of ['/students', '/students/invite']) {
    await page.goto(path);
    await expect(page).not.toHaveURL(new RegExp(`${path}$`));
  }
});

test('a branch coach can open and edit a student of their own branch', async ({ page }) => {
  const north = await addBranch(s, 'North');
  await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, branchId: north.id } });
  const coach = await addPerson('Bo', 'Branch', [{ role: 'INSTRUCTOR', schoolId: s.schoolId, branchId: north.id }]);
  await signIn(page, coach.token);
  await page.goto(`/students/${s.student.id}`);
  await expect(page.getByRole('heading', { level: 1, name: s.student.name })).toBeVisible();
  await page.getByRole('button', { name: 'Edit profile' }).click();
  await expect(page.getByLabel('First name')).toHaveValue('Sam');
  await page.getByLabel('Gender').selectOption('MALE');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  expect((await db.user.findUniqueOrThrow({ where: { id: s.student.id } })).gender).toBe('MALE');
});

test('Invite needs no home branch when every branch is archived', async ({ page }) => {
  await db.branch.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'Old Hall', archivedAt: new Date() } });
  const person = await addPerson('Ivy', 'Invitee');
  await page.goto('/students/invite');
  await page.getByLabel('Email').fill(person.email);
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.getByLabel('Home branch')).toHaveCount(0);
  await page.getByRole('button', { name: 'Enroll' }).click();
  await expect(page.getByText('Enrolled.')).toBeVisible();
});

test('Revoke lists what is still live, then cancels their bookings and waitlist places (Decision 343)', async ({ page }) => {
  const pack = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: 'Ten pack', price: 9000, classesIncluded: 10 } });
  const membership = await db.membership.create({
    data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: pack.id, schoolId: s.schoolId, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining: 4 },
  });
  const at = (h: number) => new Date(Date.now() + h * 3_600_000);
  const booked = await db.class.create({ data: { id: randomUUID(), schoolId: s.schoolId, title: 'Leaving class', startDate: at(48), endDate: at(49) } });
  const full = await db.class.create({ data: { id: randomUUID(), schoolId: s.schoolId, title: 'Full class', startDate: at(72), endDate: at(73) } });
  const booking = await db.booking.create({ data: { id: randomUUID(), studentId: s.student.id, classId: booked.id, schoolId: s.schoolId, sourceMembershipId: membership.id } });
  const entry = await db.waitlistEntry.create({ data: { id: randomUUID(), studentId: s.student.id, classId: full.id, schoolId: s.schoolId, position: 1 } });
  try {
    await page.goto(`/students/${s.student.id}`);
    await page.getByRole('button', { name: 'Revoke enrollment' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Cancels 1 upcoming booking')).toBeVisible();
    await expect(dialog.getByText('Removes them from 1 waitlist')).toBeVisible();
    await expect(dialog.getByText('Ten pack: 4 classes left')).toBeVisible();
    await dialog.getByRole('button', { name: 'Revoke' }).click();
    await expect(page).toHaveURL(/\/students$/);

    expect(await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ status: 'CANCELLED', refundResolution: 'REFUNDED' });
    expect((await db.waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe('CANCELLED');
    expect((await db.membership.findUniqueOrThrow({ where: { id: membership.id } })).classesRemaining).toBe(5);
  } finally {
    await db.waitlistEntry.deleteMany({ where: { studentId: s.student.id } });
    await db.booking.deleteMany({ where: { studentId: s.student.id } });
    await db.membership.delete({ where: { id: membership.id } });
    await db.membershipPlan.delete({ where: { id: pack.id } });
    await db.class.deleteMany({ where: { id: { in: [booked.id, full.id] } } });
  }
});

/** An account the API made (Add manually): not one the fixtures track. */
async function removeAccount(email: string) {
  const user = await db.user.findUnique({ where: { email } });
  if (!user) return;
  await db.notification.deleteMany({ where: { userId: user.id } });
  await db.waiverSignature.deleteMany({ where: { studentId: user.id } });
  await db.studentHomeBranch.deleteMany({ where: { studentId: user.id } });
  await db.roleGrant.deleteMany({ where: { userId: user.id } });
  await db.user.delete({ where: { id: user.id } });
}

test('Add manually makes an adult\'s account and enrols them; the list finds them by search and branch (Decision 371)', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const email = `add-manually-${randomUUID()}@example.test`;
  try {
    await page.goto('/students');
    await page.getByRole('button', { name: 'Add manually' }).click();
    await expect(page).toHaveURL(/\/students\/add$/);
    await page.getByLabel('First name').fill('Ada');
    await page.getByLabel('Surname').fill('Lovelace');
    await page.getByLabel('Date of birth').fill('1990-05-01');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Home branch').selectOption(north.id);
    await page.getByRole('button', { name: 'Add Student' }).click();
    await expect(page.getByText('Ada Lovelace has been added.')).toBeVisible();
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.mustChangePasscode).toBe(true);
    expect((await db.studentHomeBranch.findFirstOrThrow({ where: { studentId: user.id, schoolId: s.schoolId } })).branchId).toBe(north.id);
    // Decision 403: the owner is always shown the temporary passcode once.
    await expect(page.getByTestId('temporary-passcode')).toHaveText(/^\d{6}$/);

    await page.getByRole('button', { name: 'Back to Students' }).click();
    await expect(page.getByRole('row', { name: /Ada Lovelace/ }).getByText('North')).toBeVisible();
    await page.locator('#students-search').fill('lovel');
    await expect(page.getByRole('row', { name: /Ada Lovelace/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Sam Lee/ })).toHaveCount(0);
    await page.locator('#students-search').fill('');
    await page.locator('#students-branch-filter').selectOption({ label: 'No home branch' });
    await expect(page.getByRole('row', { name: /Sam Lee/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Ada Lovelace/ })).toHaveCount(0);
  } finally {
    await removeAccount(email);
  }
});

test('the list pages at 25 students', async ({ page }) => {
  for (let i = 0; i < 25; i++) await addPerson(`Pupil${String(i).padStart(2, '0')}`, 'Paged', [{ role: 'STUDENT', schoolId: s.schoolId }]);
  await page.goto('/students');
  await expect(page.getByText('Page 1 of 2')).toBeVisible();
  const firstPage = await page.locator('tbody tr').count();
  expect(firstPage).toBe(25);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  expect(await page.locator('tbody tr').count()).toBeGreaterThan(0);
  expect(await page.locator('tbody tr').count()).toBeLessThan(25);
});

test('the owner re-enrols a former student from their page, and a child\'s page names their Guardian (Decision 371)', async ({ page }) => {
  await db.roleGrant.updateMany({ where: { userId: s.student.id, schoolId: s.schoolId, role: 'STUDENT' }, data: { revokedAt: new Date() } });
  await page.goto(`/students/${s.student.id}`);
  await page.getByRole('button', { name: 'Re-enrol' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Re-enrol' }).click();
  await expect(page.getByRole('button', { name: 'Revoke enrollment' })).toBeVisible();
  await expect(page.getByText('Inactive', { exact: true })).toHaveCount(0);
  expect(await db.roleGrant.count({ where: { userId: s.student.id, schoolId: s.schoolId, role: 'STUDENT', revokedAt: null } })).toBe(1);

  const guardian = await addPerson('Gail', 'Guard');
  await db.guardianLink.create({ data: { guardianId: guardian.id, studentId: s.newStudent.id } });
  try {
    await page.goto(`/students/${s.newStudent.id}`);
    await expect(page.getByTestId('student-guardians')).toHaveText('Guardian: Gail Guard');
  } finally {
    await db.guardianLink.deleteMany({ where: { studentId: s.newStudent.id } });
  }
});

test('the Revoke dialog says a cancelled Subscription ends on its date', async ({ page }) => {
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: 'Monthly', price: 5000 } });
  const cancelAt = new Date(Date.now() + 10 * 86_400_000);
  const membership = await db.membership.create({
    data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: plan.id, schoolId: s.schoolId, status: 'ACTIVE', frequency: 'RECURRING', stripeSubscriptionId: `sub_e2e_${randomUUID()}`, cancelAt },
  });
  try {
    await page.goto(`/students/${s.student.id}`);
    await page.getByRole('button', { name: 'Revoke enrollment' }).click();
    await expect(page.getByRole('dialog').getByText(/^Monthly: already cancelled, ends /)).toBeVisible();
  } finally {
    await db.membership.delete({ where: { id: membership.id } });
    await db.membershipPlan.delete({ where: { id: plan.id } });
  }
});
