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
  await page.getByLabel('Gender').fill('Male');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  expect((await db.user.findUniqueOrThrow({ where: { id: s.student.id } })).gender).toBe('Male');
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
