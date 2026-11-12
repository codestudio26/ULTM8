import { expect, test, type Page } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 255's own flagged follow-up, closed: a School Owner holding
 * SCHOOL_OWNER_MANAGER at more than one School (nothing in the schema
 * prevents it) can now pick which one they're acting as, the same way
 * coach-school-switcher.spec.ts already covers for coaches.
 */
/** The switcher is the new look's own drop-down (a combobox button and its
 * listbox, not a browser <select>): the School it shows, and a pick by name. */
const switcherOf = (page: Page) => page.getByRole('combobox', { name: 'Switch School' });
const shownSchool = (page: Page) => switcherOf(page).locator('[data-shown="true"]');
async function openSwitcher(page: Page) {
  await switcherOf(page).click();
  return page.getByRole('listbox', { name: 'Switch School' });
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

  const switcher = switcherOf(page);
  await expect(switcher).toBeVisible();
  await expect(shownSchool(page)).toHaveText(firstSchool.name);
  await expect(page.getByRole('heading', { name: 'School profile' })).toBeVisible();
  // The page header's own subtitle class (the new look's NewLookPageHeader),
  // not `getByText`/`getByRole('paragraph')` —
  // the switcher's own options carry the same School name text, and an
  // unaffiliated School's own "This School is independent" copy is also a
  // plain <p>, so either of those generic queries hits a strict-mode
  // ambiguity this scoped selector avoids.
  const subtitle = page.locator('.u8n-page-header__subtitle');
  await expect(subtitle).toHaveText(firstSchool.name);

  await (await openSwitcher(page)).getByRole('option', { name: secondSchool.name, exact: true }).click();
  await expect(subtitle).toHaveText(secondSchool.name);

  // The pick survives a full navigation away and back (sessionStorage-backed).
  await page.goto('/dashboard');
  await page.goto('/school');
  await expect(shownSchool(page)).toHaveText(secondSchool.name);
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

  const list = await openSwitcher(page);
  await expect(list.getByRole('option', { name: firstSchool.name })).toBeAttached();
  await expect(list.getByRole('option', { name: secondSchool.name })).toBeAttached();
});

test('an Owner of one School who also coaches at a second starts on the School they own', async ({ page }) => {
  const owner = await addPerson('Olive', 'Owner', [
    { role: 'SCHOOL_OWNER_MANAGER', schoolId: s1.schoolId },
    { role: 'INSTRUCTOR', schoolId: s2.schoolId },
  ]);
  await signIn(page, owner.token);
  await page.goto('/');
  // Coaches review CP4: the switcher now also lists the coached School (see
  // coach-school-switcher.spec.ts), but until they pick it they work as owner.
  await expect(page).toHaveURL(/\/dashboard$/);
  const ownedSchool = await db.school.findUniqueOrThrow({ where: { id: s1.schoolId } });
  await expect(shownSchool(page)).toHaveText(`${ownedSchool.name} · School Owner`);
  // Transactions is a page of Billing.
  await expect(page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: 'Billing' })).toBeVisible();
});
