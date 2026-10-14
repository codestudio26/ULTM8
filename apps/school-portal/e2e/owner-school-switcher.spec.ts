import { expect, test } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 255's own flagged follow-up, closed: a School Owner holding
 * SCHOOL_OWNER_MANAGER at more than one School (nothing in the schema
 * prevents it) can now pick which one they're acting as, the same way
 * coach-school-switcher.spec.ts already covers for coaches.
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

test('an Owner at one School sees no switcher at all', async ({ page }) => {
  const owner = await addPerson('Olive', 'Owner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: s1.schoolId }]);
  await signIn(page, owner.token);
  await page.goto('/dashboard');
  await expect(page.getByRole('combobox', { name: 'Switch School' })).toHaveCount(0);
});

test('an Owner at two Schools can switch which one they act as, and it sticks across navigation', async ({ page }) => {
  // Same sort useOwnedSchoolIds itself uses (plain string sort), so the test
  // knows which School the switcher defaults to without depending on UUID
  // generation order.
  const [firstId, secondId] = [s1.schoolId, s2.schoolId].sort();
  const [firstSchool, secondSchool] = await Promise.all([
    db.school.findUniqueOrThrow({ where: { id: firstId } }),
    db.school.findUniqueOrThrow({ where: { id: secondId } }),
  ]);

  const owner = await addPerson('Olive', 'Owner', [
    { role: 'SCHOOL_OWNER_MANAGER', schoolId: s1.schoolId },
    { role: 'SCHOOL_OWNER_MANAGER', schoolId: s2.schoolId },
  ]);
  await signIn(page, owner.token);
  await page.goto('/school');

  const switcher = page.getByRole('combobox', { name: 'Switch School' });
  await expect(switcher).toBeVisible();
  await expect(switcher).toHaveValue(firstSchool.id);
  await expect(page.getByRole('heading', { name: 'School profile' })).toBeVisible();
  // PageHeader's own subtitle class, not `getByText`/`getByRole('paragraph')` —
  // the switcher's own <option> carries the same School name text, and an
  // unaffiliated School's own "This School is independent" copy is also a
  // plain <p>, so either of those generic queries hits a strict-mode
  // ambiguity this scoped selector avoids.
  const subtitle = page.locator('.ultm8-page-header__subtitle');
  await expect(subtitle).toHaveText(firstSchool.name);

  await switcher.selectOption(secondSchool.id);
  await expect(subtitle).toHaveText(secondSchool.name);

  // The pick survives a full navigation away and back (sessionStorage-backed).
  await page.goto('/dashboard');
  await page.goto('/school');
  await expect(switcher).toHaveValue(secondSchool.id);
  await expect(subtitle).toHaveText(secondSchool.name);
});

test('the switcher offers both owned School names as options', async ({ page }) => {
  const [firstId, secondId] = [s1.schoolId, s2.schoolId].sort();
  const [firstSchool, secondSchool] = await Promise.all([
    db.school.findUniqueOrThrow({ where: { id: firstId } }),
    db.school.findUniqueOrThrow({ where: { id: secondId } }),
  ]);
  const owner = await addPerson('Olive', 'Owner', [
    { role: 'SCHOOL_OWNER_MANAGER', schoolId: s1.schoolId },
    { role: 'SCHOOL_OWNER_MANAGER', schoolId: s2.schoolId },
  ]);
  await signIn(page, owner.token);
  await page.goto('/dashboard');

  const switcher = page.getByRole('combobox', { name: 'Switch School' });
  await expect(switcher.getByRole('option', { name: firstSchool.name })).toBeAttached();
  await expect(switcher.getByRole('option', { name: secondSchool.name })).toBeAttached();
});

test('an Owner of one School who also coaches at a second never sees the coach switcher instead', async ({ page }) => {
  const owner = await addPerson('Olive', 'Owner', [
    { role: 'SCHOOL_OWNER_MANAGER', schoolId: s1.schoolId },
    { role: 'INSTRUCTOR', schoolId: s2.schoolId },
  ]);
  await signIn(page, owner.token);
  await page.goto('/dashboard');
  // Only one owned School — no switcher at all, even though there's a second,
  // coached School (Shell.tsx's isCoachOnly logic means this person always
  // gets the Owner nav, never the Coach one, so the Owner side is what must
  // resolve, not the coach side).
  await expect(page.getByRole('combobox', { name: 'Switch School' })).toHaveCount(0);
});
