import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'crypto';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 184 item 4's own named follow-up, resolved: a coach/Branch Staff
 * member with an active grant at more than one School can now pick which one
 * they're acting as (apps/school-portal/src/coach/SchoolSwitcher.tsx), instead
 * of silently landing on whichever School happens to sort first.
 */
/** The switcher is the new look's own drop-down (a combobox button and its
 * listbox, not a browser <select>): the School it shows, and a pick by name. */
const switcherOf = (page: Page) => page.getByRole('combobox', { name: 'Switch School' });
const shownSchool = (page: Page) => switcherOf(page).locator('[data-shown="true"]');
async function openSwitcher(page: Page) {
  await switcherOf(page).click();
  return page.getByRole('listbox', { name: 'Switch School' });
}
async function pickSchool(page: Page, option: string) {
  await (await openSwitcher(page)).getByRole('option', { name: option, exact: true }).click();
}

let s1: GradingSchool;
let s2: GradingSchool;

test.beforeEach(async () => {
  s1 = await seedGradingSchool();
  s2 = await seedGradingSchool();
});

test.afterAll(async () => {
  await cleanup();
});

test('a coach at one School sees no switcher at all', async ({ page }) => {
  const coach = await addPerson('Cody', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s1.schoolId }]);
  await signIn(page, coach.token);
  await page.goto('/coach');
  await expect(page.getByRole('heading', { name: 'Coach dashboard' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Switch School' })).toHaveCount(0);
});

test('a coach at two Schools can switch which one they act as, and it sticks across navigation', async ({ page }) => {
  // Same sort the hook itself uses (useCoachSchoolIds — plain string sort), so
  // the test knows which School the switcher defaults to without depending on
  // UUID generation order.
  const [firstId, secondId] = [s1.schoolId, s2.schoolId].sort();
  const first = firstId === s1.schoolId ? s1 : s2;
  const second = firstId === s1.schoolId ? s2 : s1;
  const [firstSchool, secondSchool] = await Promise.all([
    db.school.findUniqueOrThrow({ where: { id: first.schoolId } }),
    db.school.findUniqueOrThrow({ where: { id: second.schoolId } }),
  ]);

  const coach = await addPerson('Cody', 'Coach', [
    { role: 'INSTRUCTOR', schoolId: s1.schoolId },
    { role: 'INSTRUCTOR', schoolId: s2.schoolId },
  ]);
  // Only the second School has a class on this coach's timetable — the
  // observable signal that the switcher actually changed which School's data
  // the dashboard is reading, not just its own displayed value.
  await db.timetableSlot.create({
    data: {
      id: randomUUID(), schoolId: second.schoolId, instructorId: coach.id, weekday: 'TUESDAY', title: 'Kids BJJ',
      startTime: new Date('1970-01-01T17:00:00Z'), endTime: new Date('1970-01-01T18:00:00Z'),
    },
  });

  await signIn(page, coach.token);
  await page.goto('/coach');

  const switcher = switcherOf(page);
  await expect(switcher).toBeVisible();
  await expect(shownSchool(page)).toHaveText(firstSchool.name);
  await expect(page.getByRole('region', { name: 'My classes' })).not.toContainText('Kids BJJ');

  await pickSchool(page, secondSchool.name);
  await expect(page.getByRole('region', { name: 'My classes' }).getByText(/Tuesday .*Kids BJJ/)).toBeVisible();

  // The pick survives a full navigation away and back (sessionStorage-backed).
  await page.goto('/grading');
  await page.goto('/coach');
  await expect(shownSchool(page)).toHaveText(secondSchool.name);
  await expect(page.getByRole('region', { name: 'My classes' }).getByText(/Tuesday .*Kids BJJ/)).toBeVisible();
});

test('the switcher offers both School names as options', async ({ page }) => {
  const [firstId, secondId] = [s1.schoolId, s2.schoolId].sort();
  const [firstSchool, secondSchool] = await Promise.all([
    db.school.findUniqueOrThrow({ where: { id: firstId } }),
    db.school.findUniqueOrThrow({ where: { id: secondId } }),
  ]);
  const coach = await addPerson('Cody', 'Coach', [
    { role: 'INSTRUCTOR', schoolId: s1.schoolId },
    { role: 'INSTRUCTOR', schoolId: s2.schoolId },
  ]);
  await signIn(page, coach.token);
  await page.goto('/coach');

  const list = await openSwitcher(page);
  await expect(list.getByRole('option', { name: firstSchool.name })).toBeAttached();
  await expect(list.getByRole('option', { name: secondSchool.name })).toBeAttached();
});

test('an owner who also coaches at another School picks it in the switcher and gets its coach screens (Coaches review CP4, CP6)', async ({ page }) => {
  const [ownedSchool, coachedSchool] = await Promise.all([
    db.school.findUniqueOrThrow({ where: { id: s1.schoolId } }),
    db.school.findUniqueOrThrow({ where: { id: s2.schoolId } }),
  ]);
  const person = await addPerson('Owen', 'Coach', [
    { role: 'SCHOOL_OWNER_MANAGER', schoolId: s1.schoolId },
    { role: 'INSTRUCTOR', schoolId: s2.schoolId },
  ]);
  await db.gradingPermission.create({ data: { id: randomUUID(), schoolId: s2.schoolId, userId: person.id, disciplineId: s2.disciplineId, canPromote: true } });
  await signIn(page, person.token);
  await page.goto('/');
  await expect(page).toHaveURL(/\/dashboard$/);
  const nav = page.getByRole('navigation', { name: 'Main menu' });
  // Transactions is a page of Billing.
  await expect(nav.getByRole('link', { name: 'Billing' })).toBeVisible();

  // Typing /coach as an owner goes back to the owner's home: its links would open the owned School.
  await page.goto('/coach');
  await expect(page).toHaveURL(/\/dashboard$/);

  const list = await openSwitcher(page);
  await expect(list.getByRole('option')).toHaveText([`${ownedSchool.name} · School Owner`, `${coachedSchool.name} · Coach`]);
  await list.getByRole('option', { name: `${coachedSchool.name} · Coach`, exact: true }).click();

  await expect(page).toHaveURL(/\/coach$/);
  await expect(page.getByRole('heading', { name: 'Coach dashboard' })).toBeVisible();
  await expect(page.getByText(coachedSchool.name, { exact: true }).first()).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Billing' })).toHaveCount(0);
  await expect(page.getByText('Coach', { exact: true })).toBeVisible(); // role in the header (CP6)

  // The Grading link now opens the coached School's board, where they may promote.
  await page.getByRole('link', { name: 'Open the Grading Board' }).click();
  await expect(page).toHaveURL(/\/grading$/);
  await expect(shownSchool(page)).toHaveText(`${coachedSchool.name} · Coach`);
  await expect(page.getByRole('link', { name: 'Permissions', exact: true })).toHaveCount(0);

  // And back to owning.
  await pickSchool(page, `${ownedSchool.name} · School Owner`);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText('School Owner', { exact: true })).toBeVisible();
});

test('the header names the role held at the School being viewed (Coaches review CP6)', async ({ page }) => {
  const [firstId, secondId] = [s1.schoolId, s2.schoolId].sort();
  const person = await addPerson('Rae', 'Roles', [
    { role: 'INSTRUCTOR', schoolId: firstId },
    { role: 'BRANCH_STAFF', schoolId: secondId },
  ]);
  await signIn(page, person.token);
  await page.goto('/coach');
  await expect(page.getByText('Coach', { exact: true })).toBeVisible();
  await pickSchool(page, (await db.school.findUniqueOrThrow({ where: { id: secondId } })).name);
  await expect(page.getByText('Branch Staff', { exact: true })).toBeVisible();
});
