import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The staff Check-in page in the new look (Decision 453; DESIGN.md → "Check-in
 * and front-desk mode", staff tab, and "Check-in: nothing shown twice, cards
 * first on a phone"): the white page header with Front-desk mode (and, for
 * the owner, the Students tabs), today's classes in the grey column, the
 * Scan · Code · Name card, and Recent check-ins in the right-hand panel,
 * which moves below the page on a phone. Look only: who sees what is as
 * before (front-desk.spec.ts covers the check-ins themselves).
 */
let s: GradingSchool;
const MIN = 60_000;
const at = (ms: number) => new Date(Date.now() + ms);

// As in front-desk.spec.ts: a fixed zone where it is about 9 in the morning,
// so "today" never ends mid-test.
const offset = ((9 - new Date().getUTCHours() + 36) % 24) - 12;
test.use({ timezoneId: offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}` });

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.booking.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
  await db.class.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

/** Two Branches with a class each, and Sam Lee checked in to the first. */
async function seed() {
  const north = await addBranch(s, 'North');
  const south = await addBranch(s, 'South');
  const mk = (title: string, branchId: string) =>
    db.class.create({
      data: { id: randomUUID(), schoolId: s.schoolId, branchId, title, activities: ['BJJ'], membershipInclusion: true, capacity: 20, startDate: at(-10 * MIN), endDate: at(50 * MIN) },
    });
  const fundamentals = await mk('Fundamentals', north.id);
  await mk('Sparring', south.id);
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
  const m = await db.membership.create({ data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: plan.id, schoolId: s.schoolId, status: 'ACTIVE', frequency: 'RECURRING' } });
  await db.booking.create({
    data: { id: randomUUID(), studentId: s.student.id, classId: fundamentals.id, schoolId: s.schoolId, sourceMembershipId: m.id, status: 'COMPLETED', checkInMethod: 'SELF_SERVICE' },
  });
  return { north, south };
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Recent check-ins' });
const classes = (page: Page) => page.getByRole('region', { name: 'Today’s classes' });

test('the owner: the page header with the Students tabs, the grey class column, the check-in card and Recent check-ins in the panel', async ({ page }) => {
  await seed();
  await signIn(page, s.ownerToken);
  await page.goto('/check-in');

  await expect(page.getByRole('heading', { level: 1, name: 'Students' })).toBeVisible();
  const tabs = page.getByRole('navigation', { name: 'Students sections' });
  await expect(tabs.getByRole('link', { name: 'Check-in' })).toHaveAttribute('aria-current', 'page');
  await expect(tabs.getByRole('link', { name: 'Students', exact: true })).toBeVisible();
  // Front-desk mode is a round white outlined button in the header.
  const frontDesk = page.getByRole('link', { name: 'Front-desk mode' });
  await expect(frontDesk).toHaveAttribute('href', '/front-desk');
  await expect(frontDesk).toHaveCSS('border-radius', '999px');

  // Today's classes, in the grey column, with both Branches until one is picked.
  await expect(classes(page).getByTestId('fd-class')).toHaveCount(2);
  await expect(page.getByRole('tablist', { name: 'Check in by' })).toBeVisible();

  // Recent check-ins is the right-hand panel, beside the page on a computer.
  await expect(panel(page).getByTestId('fd-recent')).toContainText('Sam Lee');
  await expect(panel(page).getByTestId('fd-recent')).toContainText('Fundamentals');
  // Shown once: the page itself has no second Recent check-ins card.
  await expect(page.getByTestId('fd-recent')).toHaveCount(1);

  // The Branch drop-down is the new look's own; picking a Branch narrows the classes.
  await page.getByRole('combobox', { name: 'Branch' }).click();
  await page.getByRole('option', { name: 'South' }).click();
  await expect(classes(page).getByTestId('fd-class')).toHaveCount(1);
  await expect(classes(page).getByTestId('fd-class')).toContainText('Sparring');

  // Front-desk tablets stays on the page, as a new-look card with its End buttons.
  await expect(page.getByTestId('fd-tablets')).toContainText('No device is in front-desk mode.');
  // Nothing from the old look on the page.
  await expect(page.locator('.u8n-content .ultm8-card, .u8n-content .ultm8-page-header, .u8n-content .ultm8-tabs, .u8n-content select')).toHaveCount(0);
});

test('a coach: Check-in on its own, no Students tabs in the page header, the same check-in card and panel', async ({ page }) => {
  await seed();
  const coach = await addPerson('Cora', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await signIn(page, coach.token);
  await page.goto('/check-in');

  await expect(page.getByRole('heading', { level: 1, name: 'Check-in' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Students sections' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Front-desk mode' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Check in by' })).toBeVisible();
  await expect(panel(page).getByTestId('fd-recent')).toContainText('Sam Lee');
});

test('Branch Staff: Check-in on its own, as before', async ({ page }) => {
  const { north } = await seed();
  const staff = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  await signIn(page, staff.token);
  await page.goto('/check-in');

  await expect(page.getByRole('heading', { level: 1, name: 'Check-in' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Students sections' })).toHaveCount(0);
  await expect(page.getByRole('tablist', { name: 'Check in by' })).toBeVisible();
  await expect(panel(page)).toBeVisible();
});

test('on a phone: classes and the check-in card first, Recent check-ins below them, nothing scrolls sideways', async ({ page }) => {
  await seed();
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, s.ownerToken);
  await page.goto('/check-in');

  await expect(panel(page).getByTestId('fd-recent')).toContainText('Sam Lee');
  const card = await page.getByRole('region', { name: 'Check a student in' }).boundingBox();
  const recent = await panel(page).boundingBox();
  expect(card && recent && recent.y > card.y + card.height - 1).toBe(true);
  for (const method of ['Scan', 'Code', 'Name']) {
    await page.getByRole('tab', { name: method }).click();
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(wide).toBeLessThanOrEqual(0);
  }
});
