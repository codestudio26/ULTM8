import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addCoach, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Instructors review fixes (Decision 311) as the owner sees them: every
 * instructor listed A to Z with their status, Archive asking first, archived
 * and revoked instructors kept out of the Class picker, the detail page's
 * upcoming and past classes, and the revoke warning.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterEach(async () => {
  await db.class.deleteMany({ where: { schoolId: s.schoolId } });
  await db.instructor.deleteMany({ where: { schoolId: s.schoolId } });
});

test.afterAll(async () => {
  await cleanup();
});

async function addProfile(first: string, last: string, opts: { archived?: boolean; revoked?: boolean } = {}) {
  const coach = await addCoach(s, first, last);
  if (opts.revoked) await db.roleGrant.updateMany({ where: { userId: coach.id, schoolId: s.schoolId }, data: { revokedAt: new Date() } });
  const profile = await db.instructor.create({
    data: { id: randomUUID(), userId: coach.id, schoolId: s.schoolId, archivedAt: opts.archived ? new Date() : null },
  });
  return { ...coach, profileId: profile.id };
}

test('every instructor is listed, A to Z, with an Active or Revoked status', async ({ page }) => {
  // More than one page of the API's default 20.
  for (let n = 1; n <= 23; n++) await addProfile(`Coach${String(n).padStart(2, '0')}`, 'Many');
  await addProfile('Aaron', 'First');
  await addProfile('Zed', 'Revoked', { revoked: true });

  await signIn(page, s.ownerToken);
  await page.goto('/instructors');
  await expect(page.getByRole('row', { name: /Coach23 Many/ })).toBeVisible();
  const names = await page.getByRole('row').allInnerTexts();
  const people = names.filter((r) => /Many|First|Revoked/.test(r));
  expect(people).toHaveLength(25);
  expect(people[0]).toContain('Aaron First');
  expect(people[24]).toContain('Zed Revoked');
  await expect(page.getByRole('row', { name: /Aaron First/ }).getByText('Active', { exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /Zed Revoked/ }).getByText('Revoked', { exact: true })).toBeVisible();
});

test('Archive asks first; Cancel leaves the instructor as they were', async ({ page }) => {
  const coach = await addProfile('Ari', 'Archive');
  await signIn(page, s.ownerToken);
  await page.goto('/instructors');
  const row = page.getByRole('row', { name: /Ari Archive/ });
  await row.getByRole('button', { name: /Actions for Ari Archive/ }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();

  const dialog = page.getByRole('dialog', { name: 'Archive Ari Archive?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect((await db.instructor.findUniqueOrThrow({ where: { id: coach.profileId } })).archivedAt).toBeNull();

  await row.getByRole('button', { name: /Actions for Ari Archive/ }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page.getByRole('dialog', { name: 'Archive Ari Archive?' }).getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('row', { name: /Ari Archive/ })).toHaveCount(0);
  expect((await db.instructor.findUniqueOrThrow({ where: { id: coach.profileId } })).archivedAt).not.toBeNull();
});

test('a new Class offers only active instructors, not archived or revoked ones', async ({ page }) => {
  await addProfile('Amy', 'Active');
  const archived = await addProfile('Arlo', 'Archived', { archived: true });
  await addProfile('Rex', 'Revoked', { revoked: true });
  await db.class.create({
    data: {
      id: randomUUID(), schoolId: s.schoolId, instructorId: archived.id, title: 'Old class',
      startDate: new Date(Date.now() - 7 * 86_400_000), endDate: new Date(Date.now() - 7 * 86_400_000 + 3_600_000),
    },
  });

  await signIn(page, s.ownerToken);
  await page.goto('/classes');
  await page.getByRole('button', { name: /Add class|New class|Create class/ }).first().click();
  const picker = page.getByRole('dialog').getByLabel('Instructor');
  const options = await picker.locator('option').allInnerTexts();
  expect(options).toContain('Amy Active');
  expect(options.some((o) => o.includes('Arlo'))).toBe(false);
  expect(options.some((o) => o.includes('Rex'))).toBe(false);
});

test('the detail page splits upcoming and past classes, and Revoke warns about upcoming ones', async ({ page }) => {
  const coach = await addProfile('Dee', 'Detail');
  const day = 86_400_000;
  const mk = (title: string, offsetDays: number) =>
    db.class.create({
      data: { id: randomUUID(), schoolId: s.schoolId, instructorId: coach.id, title, startDate: new Date(Date.now() + offsetDays * day), endDate: new Date(Date.now() + offsetDays * day + 3_600_000) },
    });
  await mk('Soon', 1);
  await mk('Later', 5);
  await mk('Last week', -7);
  await db.class.create({
    data: { id: randomUUID(), schoolId: s.schoolId, instructorId: coach.id, title: 'Archived one', archivedAt: new Date(), startDate: new Date(Date.now() + 2 * day), endDate: new Date(Date.now() + 2 * day + 3_600_000) },
  });

  await signIn(page, s.ownerToken);
  await page.goto(`/instructors/${coach.profileId}`);
  await expect(page.getByRole('heading', { name: 'Upcoming classes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Past classes' })).toBeVisible();
  const upcomingText = await page.getByRole('heading', { name: 'Upcoming classes' }).locator('xpath=following-sibling::*[1]').innerText();
  expect(upcomingText.indexOf('Soon')).toBeLessThan(upcomingText.indexOf('Later'));
  expect(upcomingText).not.toContain('Last week');
  await expect(page.getByText('Archived one')).toHaveCount(0);

  await page.getByRole('button', { name: 'Revoke enrollment' }).click();
  const dialog = page.getByRole('dialog', { name: "Revoke Dee Detail's enrollment?" });
  await expect(dialog.getByText(/They still teach 2 upcoming classes/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Revoke' }).click();
  await expect(page).toHaveURL(/\/instructors$/);
  await expect(page.getByRole('row', { name: /Dee Detail/ }).getByText('Revoked', { exact: true })).toBeVisible();
});

test('a coach who opens the Instructors page goes to their own start page', async ({ page }) => {
  const coach = await addPerson('Cory', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await signIn(page, coach.token);
  await page.goto('/instructors');
  await expect(page).not.toHaveURL(/\/instructors$/);
});
