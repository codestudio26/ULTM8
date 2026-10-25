import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addBranch, addCoach, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Instructors features (Decision 312) as the owner and a coach see them:
 * roster search and filters, inviting an existing user straight into "Add
 * instructor", the richer detail page with "Hand over classes" and "Give
 * Instructor role back", and Complete Profile starting from what's saved.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterEach(async () => {
  await db.class.deleteMany({ where: { schoolId: s.schoolId } });
  await db.timetableSlot.deleteMany({ where: { schoolId: s.schoolId } });
  await db.instructor.deleteMany({ where: { schoolId: s.schoolId } });
});

test.afterAll(async () => {
  await cleanup();
});

async function addProfile(first: string, last: string, data: Record<string, unknown> = {}) {
  const coach = await addCoach(s, first, last);
  const profile = await db.instructor.create({ data: { id: randomUUID(), userId: coach.id, schoolId: s.schoolId, ...data } });
  return { ...coach, profileId: profile.id };
}

test('search and the status filter narrow the roster, and a manually added instructor shows as not signed in yet', async ({ page }) => {
  await addProfile('Alma', 'Search');
  const fresh = await addProfile('Bea', 'Fresh');
  await db.user.update({ where: { id: fresh.id }, data: { mustChangePasscode: true } });

  await signIn(page, s.ownerToken);
  await page.goto('/instructors');
  await expect(page.getByRole('row', { name: /Bea Fresh/ }).getByText("Hasn't signed in yet")).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('alma');
  await expect(page.getByRole('row', { name: /Alma Search/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Bea Fresh/ })).toHaveCount(0);

  await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('');
  await page.getByLabel('Status', { exact: true }).selectOption({ label: "Hasn't signed in yet" });
  await expect(page.getByRole('row', { name: /Bea Fresh/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Alma Search/ })).toHaveCount(0);

  await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('nobody-matches');
  await expect(page.getByText('No instructors match')).toBeVisible();
});

test('inviting an existing user opens Add instructor with them already picked', async ({ page }) => {
  const person = await addPerson('Ivy', 'Existing');
  await signIn(page, s.ownerToken);
  await page.goto('/instructors');
  await page.getByRole('button', { name: 'Invite existing user' }).click();
  const invite = page.getByRole('dialog', { name: 'Invite to Instructor role' });
  await invite.getByLabel('Email').fill(person.email);
  await invite.getByRole('button', { name: 'Find' }).click();
  await invite.getByRole('button', { name: 'Grant Instructor role' }).click();

  const add = page.getByRole('dialog', { name: /Add instructor/i });
  await expect(add).toBeVisible();
  await expect(add.getByLabel('User')).toHaveValue(person.id);
  await add.getByRole('button', { name: /^(Save|Add|Create)/ }).click();
  await expect(page.getByRole('row', { name: /Ivy Existing/ })).toBeVisible();
});

test('the detail page shows what the instructor filled in, and hands their classes to someone else', async ({ page }) => {
  const branch = await addBranch(s, 'North Dojo');
  const leaving = await addProfile('Lea', 'Leaving', {
    branchId: branch.id,
    activities: ['Judo'],
    address: '1 Main St, Springfield',
    certificationKey: `instructor-certifications/${s.schoolId}/x/cert.pdf`,
    certificationConsentedAt: new Date(),
  });
  await db.roleGrant.updateMany({ where: { userId: leaving.id, schoolId: s.schoolId }, data: { branchId: null } });
  const takeover = await addProfile('Tom', 'Takeover');
  const day = 86_400_000;
  const upcoming = await db.class.create({
    data: { id: randomUUID(), schoolId: s.schoolId, instructorId: leaving.id, title: 'Tuesday fundamentals', startDate: new Date(Date.now() + 2 * day), endDate: new Date(Date.now() + 2 * day + 3_600_000) },
  });
  const slot = await db.timetableSlot.create({
    data: { id: randomUUID(), schoolId: s.schoolId, instructorId: leaving.id, weekday: 'MONDAY', startTime: new Date(Date.UTC(1970, 0, 1, 18, 0)), endTime: new Date(Date.UTC(1970, 0, 1, 19, 0)), title: 'Monday sparring' },
  });

  await signIn(page, s.ownerToken);
  await page.goto(`/instructors/${leaving.profileId}`);
  await expect(page.getByText('North Dojo')).toBeVisible();
  await expect(page.getByText('Judo', { exact: true })).toBeVisible();
  await expect(page.getByText('1 Main St, Springfield')).toBeVisible();
  await expect(page.getByText(/On file, consent given/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'View' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Weekly timetable' })).toBeVisible();
  await expect(page.getByText('Monday sparring')).toBeVisible();

  await page.getByRole('button', { name: 'Hand over classes' }).click();
  const dialog = page.getByRole('dialog', { name: "Hand over Lea Leaving's classes" });
  const picker = dialog.getByLabel('New instructor');
  expect(await picker.locator('option').allInnerTexts()).not.toContain('Lea Leaving');
  await picker.selectOption({ label: 'Tom Takeover' });
  await dialog.getByRole('button', { name: 'Hand over' }).click();
  await expect(page.getByText('Tom Takeover took over. Upcoming classes moved: 1. Weekly slots moved: 1.')).toBeVisible();

  expect((await db.class.findUniqueOrThrow({ where: { id: upcoming.id } })).instructorId).toBe(takeover.id);
  expect((await db.timetableSlot.findUniqueOrThrow({ where: { id: slot.id } })).instructorId).toBe(takeover.id);
  await expect(page.getByRole('button', { name: 'Hand over classes' })).toHaveCount(0);
});

test('a revoked instructor can be given the role back from their detail page', async ({ page }) => {
  const coach = await addProfile('Rae', 'Returning');
  await db.roleGrant.updateMany({ where: { userId: coach.id, schoolId: s.schoolId }, data: { revokedAt: new Date() } });

  await signIn(page, s.ownerToken);
  await page.goto(`/instructors/${coach.profileId}`);
  await page.getByRole('button', { name: 'Give Instructor role back' }).click();
  const dialog = page.getByRole('dialog', { name: 'Give Rae Returning the Instructor role again?' });
  await dialog.getByRole('button', { name: 'Give role back' }).click();
  await expect(page.getByText('Rae Returning is an instructor here again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revoke enrollment' })).toBeVisible();
  expect(await db.roleGrant.count({ where: { userId: coach.id, schoolId: s.schoolId, role: 'INSTRUCTOR', revokedAt: null } })).toBe(1);
});

test('Complete your profile starts from what the instructor already saved', async ({ page }) => {
  const coach = await addPerson('Cleo', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await db.instructor.create({
    data: { id: randomUUID(), userId: coach.id, schoolId: s.schoolId, activities: ['Judo', 'BJJ'], certificationKey: 'instructor-certifications/x/y/z.pdf' },
  });

  await signIn(page, coach.token);
  await page.goto('/complete-instructor-profile');
  await expect(page.getByLabel('Activities')).toHaveValue('Judo, BJJ');
  await expect(page.getByText('You already have a certification on file.', { exact: false })).toBeVisible();
});
