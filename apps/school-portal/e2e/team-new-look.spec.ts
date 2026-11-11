import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The Team pages in the new look (Decision 453; DESIGN.md → "Team member full
 * page", "nothing shown twice", "Side panel buttons sit under the content"):
 * Instructors and Staff with the picked person in a panel that never repeats
 * their row, and an instructor's own page with Profile and Classes tabs.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // BJJ: White 0–2, Blue 0
});

test.afterEach(async () => {
  await db.instructorBelt.deleteMany({ where: { schoolId: s.schoolId } });
  await db.instructor.deleteMany({ where: { schoolId: s.schoolId } });
});

test.afterAll(async () => {
  await cleanup();
});

async function seedTeam() {
  const north = await addBranch(s, 'North');
  const ana = await addPerson('Ana', 'Pereira', [{ role: 'INSTRUCTOR', schoolId: s.schoolId, branchId: north.id }]);
  const joana = await addPerson('Joana', 'Reis', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  const profile = await db.instructor.create({ data: { id: randomUUID(), userId: ana.id, schoolId: s.schoolId, branchId: north.id, yearsOfExperience: 8 } });
  await db.instructorBelt.create({
    data: { id: randomUUID(), schoolId: s.schoolId, userId: ana.id, disciplineId: s.disciplineId, rankId: s.rung['Blue 0'].rankId, stripeTierId: s.rung['Blue 0'].id },
  });
  return { north, ana, joana, profile };
}

test('Staff: the panel shows the picked person\'s belts and switches, never their row', async ({ page }) => {
  const { ana, joana, profile } = await seedTeam();
  await signIn(page, s.ownerToken);
  await page.goto('/staff');
  await expect(page.getByRole('heading', { level: 1, name: 'Team' })).toBeVisible();
  const list = page.locator('.u8t-card', { has: page.getByRole('heading', { name: 'Your staff' }) });
  await expect(list.getByRole('link', { name: 'Grading permissions ›' })).toHaveAttribute('href', '/grading/permissions');

  await list.getByRole('button', { name: 'Ana Pereira', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Team member' });
  await expect(panel.getByText('Ana Pereira')).toBeVisible();
  await expect(panel.getByText('Blue 0')).toBeVisible();
  await expect(panel.getByText('Not verified')).toBeVisible();
  // The row has the roles, the email and "Open full page ›"; the panel doesn't repeat them.
  await expect(panel.getByText('Instructor · North')).toHaveCount(0);
  await expect(panel.getByText(ana.email)).toHaveCount(0);
  await expect(panel.getByRole('link', { name: /Open full page/ })).toHaveCount(0);

  // Only instructors with a profile have a full page.
  await expect(list.getByRole('link', { name: 'Open full page: Joana Reis' })).toHaveCount(0);

  // Branch Staff: no belts; their switches save as on the old tables.
  await list.getByRole('button', { name: 'Joana Reis', exact: true }).click();
  await expect(panel.getByText('Joana Reis')).toBeVisible();
  await expect(panel.getByText('Blue 0')).toHaveCount(0);
  const create = panel.getByRole('switch', { name: 'Can create charges' });
  await expect(create).toHaveAttribute('aria-checked', 'true');
  const openMat = panel.getByRole('switch', { name: 'Can start open mat sessions' });
  await openMat.click();
  await expect(openMat).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await db.staffPermission.findFirst({ where: { schoolId: s.schoolId, userId: joana.id } }))?.canStartOpenMat).toBe(true);
  // The everyone-at-once table further down shows the same switch, now on.
  await expect(page.getByLabel('Joana Reis can start open mat sessions')).toBeChecked();

  await list.getByRole('link', { name: 'Open full page: Ana Pereira' }).click();
  await expect(page).toHaveURL(new RegExp(`/instructors/${profile.id}$`));
});

test('a co-owner sees the switches locked', async ({ page }) => {
  await seedTeam();
  const co = await addPerson('Cara', 'Partner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: s.schoolId }]);
  await signIn(page, co.token);
  await page.goto('/staff');
  const list = page.locator('.u8t-card', { has: page.getByRole('heading', { name: 'Your staff' }) });
  await list.getByRole('button', { name: 'Joana Reis', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Team member' });
  await expect(panel.getByText("Only the account's main owner can change these switches.")).toBeVisible();
  await expect(panel.getByRole('switch', { name: 'Can create charges' })).toBeDisabled();
});

test('Instructors: the panel has Front desk and money and Grading permissions; a belt row picks the person', async ({ page }) => {
  const { profile } = await seedTeam();
  await addPerson('Rafael', 'Souza', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]).then((r) =>
    db.instructor.create({ data: { id: randomUUID(), userId: r.id, schoolId: s.schoolId } }),
  );
  await signIn(page, s.ownerToken);
  await page.goto('/instructors');
  const panel = page.getByRole('complementary', { name: 'Team member' });
  await page.getByRole('button', { name: 'Rafael Souza', exact: true }).click();
  await expect(panel.getByText('Rafael Souza')).toBeVisible();
  await expect(panel.getByRole('switch', { name: 'Can create charges' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Grading permissions ›' })).toBeVisible();

  const belts = page.locator('.u8t-card', { has: page.getByRole('heading', { name: "Instructors' belts" }) });
  await belts.getByRole('button', { name: 'Ana Pereira', exact: true }).click();
  await expect(panel.getByText('Ana Pereira')).toBeVisible();
  // The belts card shows the belt, so the panel doesn't.
  await expect(panel.getByText('Blue 0')).toHaveCount(0);

  await page.getByRole('row', { name: /Ana Pereira/ }).first().getByRole('link', { name: 'Open full page: Ana Pereira' }).click();
  await expect(page).toHaveURL(new RegExp(`/instructors/${profile.id}$`));
});

test('the team member page: ‹ Team, Profile and Classes tabs, Verify, and Edit in the panel', async ({ page }) => {
  const { ana, profile } = await seedTeam();
  await db.class.create({
    data: { id: randomUUID(), schoolId: s.schoolId, instructorId: ana.id, title: 'Tuesday fundamentals', startDate: new Date(Date.now() + 2 * 86_400_000), endDate: new Date(Date.now() + 2 * 86_400_000 + 3_600_000) },
  });
  try {
    await signIn(page, s.ownerToken);
    await page.goto(`/instructors/${profile.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Ana Pereira' })).toBeVisible();
    await expect(page.locator('.u8n-page-header').getByRole('link', { name: 'Team' })).toHaveAttribute('href', '/instructors');
    const tabs = page.getByRole('navigation', { name: 'Team member sections' });
    await expect(tabs.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');

    for (const heading of ['About', 'Belts', 'Front desk and money', 'Roles', 'Next classes', 'Remove from the team']) {
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }
    await expect(page.getByText('Tuesday fundamentals')).toBeVisible();
    await page.getByRole('button', { name: "Verify Ana Pereira's BJJ belt" }).click();
    await expect(page.locator('.u8t-card', { has: page.getByRole('heading', { name: 'Belts', exact: true }) }).getByText('Verified', { exact: true })).toBeVisible();

    // The panel: who they are and how to reach them, nothing from the page.
    const panel = page.getByRole('complementary', { name: 'Team member' });
    await expect(panel.getByText(ana.email)).toBeVisible();
    await expect(panel.getByText('Active')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit instructor' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Edit instructor' })).toBeHidden();

    await page.getByRole('link', { name: 'All classes' }).click();
    await expect(tabs.getByRole('link', { name: 'Classes' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Upcoming classes' })).toBeVisible();
    await expect(page.getByText('Tuesday fundamentals')).toBeVisible();
  } finally {
    await db.class.deleteMany({ where: { schoolId: s.schoolId } });
  }
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the panel sits straight under the staff list', async ({ page }) => {
    await seedTeam();
    await signIn(page, s.ownerToken);
    await page.goto('/staff');
    const list = page.locator('.u8t-card', { has: page.getByRole('heading', { name: 'Your staff' }) });
    await list.getByRole('button', { name: 'Joana Reis', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'Team member' });
    await expect(panel.getByRole('switch', { name: 'Can create charges' })).toBeVisible();
    // Measured in one go, so the scroll that brings the panel into view can't skew it.
    const tops = await page.evaluate(() => {
      const top = (el: Element | null | undefined) => (el ? el.getBoundingClientRect().top : NaN);
      const bottom = (el: Element | null | undefined) => (el ? el.getBoundingClientRect().bottom : NaN);
      const cards = [...document.querySelectorAll('.u8t-card')];
      const list = cards.find((c) => c.querySelector('h2')?.textContent === 'Your staff');
      const give = cards.find((c) => c.querySelector('h2')?.textContent === 'Give a role');
      return { listBottom: bottom(list), panelTop: top(document.querySelector('.u8t-under-list')), panelBottom: bottom(document.querySelector('.u8t-under-list')), giveTop: top(give) };
    });
    expect(tops.panelTop).toBeGreaterThanOrEqual(tops.listBottom);
    expect(tops.panelBottom).toBeLessThanOrEqual(tops.giveTop);
    // No sideways scrolling.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
