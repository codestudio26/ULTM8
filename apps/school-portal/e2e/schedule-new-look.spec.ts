import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addBranch, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The Schedule pages in the new look (Decision 453): Classes and the
 * Timetable keep every view, filter and action, laid out as DESIGN.md asks —
 * class avatars (a circle with the initials when there is no banner), the
 * class name with its branch under it, the new look's own drop-downs (never a
 * browser <select>), and no sideways page scroll on a phone.
 */
let s: GradingSchool;

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A one-off class later today (never past midnight), so the Week view shows it today. */
function laterToday() {
  const now = new Date();
  const last = new Date(now);
  last.setHours(22, 50, 0, 0);
  const start = new Date(Math.min(now.getTime() + 2 * 3_600_000, Math.max(now.getTime() + 60_000, last.getTime())));
  return { start, end: new Date(start.getTime() + 3_600_000) };
}

test.beforeEach(async () => {
  s = await seedGradingSchool();
  const north = await addBranch(s, 'North');
  const { start, end } = laterToday();
  await db.class.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      branchId: north.id,
      title: 'Advanced (Gi)',
      activities: ['BJJ'],
      styles: [{ disciplineId: s.disciplineId, classType: null }],
      startDate: start,
      endDate: end,
      capacity: 12,
    },
  });
});

test.afterEach(async () => {
  await db.class.deleteMany({ where: { schoolId: s.schoolId } });
});

test.afterAll(async () => {
  await cleanup();
});

test('Classes: a row shows the class avatar, its branch under the name, and the filters are the new drop-downs', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/classes');

  const row = page.getByRole('row', { name: /Advanced \(Gi\)/ });
  await expect(row).toBeVisible();
  // No banner: the initials on a soft circle (DESIGN.md → "Avatars").
  await expect(row.locator('.u8s-avatar')).toHaveText('AG');
  await expect(row.getByText('North', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Actions for Advanced (Gi)' })).toBeVisible();

  // Show and Discipline are comboboxes with listboxes, not native selects.
  await expect(page.locator('.u8s-card select')).toHaveCount(0);
  const show = page.getByRole('combobox', { name: 'Show', exact: true });
  await show.click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(page.getByRole('option', { name: 'Upcoming' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);

  // Rows/Grid and Show archived are still there.
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Advanced (Gi)')).toBeVisible();
  await expect(page.getByLabel('Show archived')).toBeVisible();
});

test('Timetable: today\'s class is a row with its avatar, time and seats, and every view and filter stays', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/timetable');

  const actions = page.getByRole('button', { name: `Actions for Advanced (Gi) on ${dateKey(new Date())}` });
  await expect(actions).toBeVisible();
  const entry = page.locator('.u8s-entry').filter({ has: actions });
  await expect(entry.locator('.u8s-avatar')).toHaveText('AG');
  await expect(entry.getByText('0 of 12 booked')).toBeVisible();
  await expect(entry.getByText('North', { exact: true })).toBeVisible();

  for (const name of ['Day', 'Week', 'Month', 'Rows', 'Grid', 'Today', 'Closures', 'Add slot']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('combobox', { name: 'Style' })).toBeVisible();
  await expect(page.getByLabel('Show archived')).toBeVisible();
});

test('on a phone neither page scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, s.ownerToken);
  for (const path of ['/classes', '/timetable']) {
    await page.goto(path);
    await expect(page.getByText('Advanced (Gi)').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
});
