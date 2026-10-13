import { expect, test } from '@playwright/test';
import { randomUUID } from 'crypto';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 184 item 4's own named follow-up, resolved: a coach/Branch Staff
 * member with an active grant at more than one School can now pick which one
 * they're acting as (apps/school-portal/src/coach/SchoolSwitcher.tsx), instead
 * of silently landing on whichever School happens to sort first.
 */
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

  const switcher = page.getByRole('combobox', { name: 'Switch School' });
  await expect(switcher).toBeVisible();
  await expect(switcher).toHaveValue(firstSchool.id);
  await expect(page.getByRole('region', { name: 'My classes' })).not.toContainText('Kids BJJ');

  await switcher.selectOption(secondSchool.id);
  await expect(page.getByRole('region', { name: 'My classes' }).getByText(/Tuesday .*Kids BJJ/)).toBeVisible();

  // The pick survives a full navigation away and back (sessionStorage-backed).
  await page.goto('/grading');
  await page.goto('/coach');
  await expect(switcher).toHaveValue(secondSchool.id);
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

  const switcher = page.getByRole('combobox', { name: 'Switch School' });
  await expect(switcher.getByRole('option', { name: firstSchool.name })).toBeAttached();
  await expect(switcher.getByRole('option', { name: secondSchool.name })).toBeAttached();
});

test('a School Owner never sees the switcher, even with a second, coached School', async ({ page }) => {
  const owner = await addPerson('Olive', 'Owner', [
    { role: 'SCHOOL_OWNER_MANAGER', schoolId: s1.schoolId },
    { role: 'INSTRUCTOR', schoolId: s2.schoolId },
  ]);
  await signIn(page, owner.token);
  await page.goto('/dashboard');
  await expect(page.getByRole('combobox', { name: 'Switch School' })).toHaveCount(0);
});
