import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addBranch, addCoach, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The Schedule pages in the new look (Decision 453): Classes and the
 * Timetable keep every view, filter and action, laid out as DESIGN.md asks —
 * class avatars (a circle with the initials when there is no banner), the
 * class name with its branch under it, the new look's own drop-downs (never a
 * browser <select>), and no sideways page scroll on a phone. Decision 455:
 * the right-hand panel shows the selected class with the row's own actions,
 * Timetable rows name the coach, and the Month dots use the soft colours. The
 * panel never repeats the row (DESIGN.md "nothing shown twice"; the owner's
 * answer "B" on #545): only the class's name, what the row doesn't show, and
 * the row's actions as buttons.
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
  // A second class with a coach (an Instructor with a profile, so the
  // Instructors list the pages already load names them).
  const coach = await addCoach(s, 'Cody', 'Coach');
  await db.instructor.create({ data: { id: randomUUID(), userId: coach.id, schoolId: s.schoolId } });
  await db.class.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      branchId: north.id,
      instructorId: coach.id,
      title: 'Kids BJJ',
      activities: ['BJJ'],
      styles: [{ disciplineId: s.disciplineId, classType: null }],
      startDate: start,
      endDate: end,
      capacity: 20,
    },
  });
});

test.afterEach(async () => {
  await db.class.deleteMany({ where: { schoolId: s.schoolId } });
  await db.instructor.deleteMany({ where: { schoolId: s.schoolId } });
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
  await expect(page.locator('.u8n-page__body').getByText('Advanced (Gi)')).toBeVisible();
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

test('Classes: the panel names the picked class, repeats nothing from its row, and has its actions under it', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/classes');

  const panel = page.getByRole('complementary', { name: 'Class' });
  await expect(panel).toBeVisible();
  const pick = page.getByRole('button', { name: 'Kids BJJ', exact: true });
  await pick.click();
  await expect(pick).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Advanced (Gi)', exact: true })).toHaveAttribute('aria-pressed', 'false');

  await expect(panel.getByText('Kids BJJ', { exact: true })).toBeVisible();
  // The row shows the coach and branch, Starts, Ends and Capacity, so the
  // panel doesn't repeat them.
  const row = page.getByRole('row', { name: /Kids BJJ/ });
  await expect(row.getByText('Cody Coach · North')).toBeVisible();
  await expect(row.locator('td[data-cell="capacity"]')).toHaveText('20');
  for (const label of ['Starts', 'Ends', 'Capacity', 'Branch', 'Instructor']) {
    await expect(panel.getByText(label, { exact: true })).toHaveCount(0);
  }
  for (const text of ['Cody Coach', 'North', '20']) {
    await expect(panel.getByText(text, { exact: true })).toHaveCount(0);
  }
  await expect(panel.locator('dl')).toHaveCount(0);
  // The row's ⋮ actions, as buttons under the content.
  for (const name of ['View bookings', 'Show QR', 'Roll call', 'Edit', 'Archive']) {
    await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
  }

  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit class' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Edit class' }).getByRole('button', { name: 'Cancel' }).click();

  await panel.getByRole('button', { name: 'Roll call', exact: true }).click();
  await expect(page).toHaveURL(/\/classes\/[^/]+\/roll-call$/);
});

test('Timetable: rows name the coach, the panel repeats nothing from the row, and Month uses the soft dot colours', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/timetable');
  const key = dateKey(new Date());

  const entry = page.locator('.u8s-entry').filter({ has: page.getByRole('button', { name: `Actions for Kids BJJ on ${key}` }) });
  await expect(entry.getByText('Cody Coach · North')).toBeVisible();

  await entry.getByRole('button', { name: 'Kids BJJ', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Class' });
  await expect(panel.getByText('Kids BJJ', { exact: true })).toBeVisible();
  // The row shows the coach and branch, the time and the seats booked, and
  // its day heading the date, so the panel doesn't repeat them.
  await expect(entry.getByText('0 of 20 booked')).toBeVisible();
  await expect(panel.getByText(/Cody Coach|North/)).toHaveCount(0);
  await expect(panel.getByText(/of 20 booked/)).toHaveCount(0);
  await expect(panel.getByText(/\d{1,2}:\d{2}/)).toHaveCount(0);
  await expect(panel.locator('dl')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Open class', exact: true })).toBeVisible();
  // A one-off class has no slot to edit.
  await expect(panel.getByRole('button', { name: 'Edit slot' })).toHaveCount(0);

  await panel.getByRole('button', { name: 'Book', exact: true }).click();
  const booking = page.getByRole('dialog', { name: 'Book — Kids BJJ' });
  await expect(booking).toBeVisible();
  await booking.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(booking).toHaveCount(0);

  // Month books from its dots and has no panel; each dot uses a soft colour.
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Class' })).toHaveCount(0);
  const dot = page.getByRole('button', { name: `Book Kids BJJ on ${key}` });
  await expect(dot).toHaveClass(/u8s-dot--c[0-5]/);
});
