import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { expect, test, type Browser } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * v1.2 backend backlog — Dashboard "Bookings This Week" drill-down. Confirms the
 * Dashboard's two KPI cards and the drill-down page's day-by-day, per-activity
 * breakdown render real, server-computed figures (GET
 * /schools/:schoolId/bookings/summary) — closing the backlog doc's own "the
 * Dashboard's own displayed numbers are unbacked placeholder copy" gap — rather
 * than re-testing every grouping/judgment-call edge case apps/api's own
 * bookings.e2e-spec.ts already covers in depth.
 */
let s: GradingSchool;
const extraIds = { membershipPlan: '', membership: '', class: '', booking: '', extraBookings: [] as string[] };
let classStartMs = 0;

test.beforeEach(async () => {
  s = await seedGradingSchool();

  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 },
  });
  extraIds.membershipPlan = plan.id;
  const membership = await db.membership.create({
    data: {
      id: randomUUID(), studentId: s.student.id, membershipPlanId: plan.id, schoolId: s.schoolId,
      status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null,
    },
  });
  extraIds.membership = membership.id;

  // Inside the current Mon–Sun week the API's own default range resolves to
  // (this School has no timezone set, so UTC — same fallback
  // BookingsService.getWeeklySummary's own default uses), and not yet ended:
  // the 15-minute no-show sweep marks a Booking NO_SHOW once its Class has
  // ended, so a fixed midday Class stopped counting as Upcoming in afternoon
  // runs. Starts shortly from now, pulled back if that would cross into next week.
  const now = new Date();
  const weekEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7) + 7);
  const startMs = Math.min(now.getTime() + 5 * 60_000, weekEnd - 20 * 60_000);
  classStartMs = startMs;
  const cls = await db.class.create({
    data: {
      id: randomUUID(), schoolId: s.schoolId, title: 'Dashboard Spec Judo', activities: ['Judo'],
      startDate: new Date(startMs), endDate: new Date(startMs + 15 * 60_000),
    },
  });
  extraIds.class = cls.id;
  const booking = await db.booking.create({
    data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: membership.id, status: 'UPCOMING' },
  });
  extraIds.booking = booking.id;
  // Decision 367: a cancelled Booking (counted apart) and a no-show (Attendance
  // card "Absent") on the same Class.
  extraIds.extraBookings = [];
  for (const status of ['CANCELLED', 'NO_SHOW'] as const) {
    const b = await db.booking.create({
      data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: membership.id, status },
    });
    extraIds.extraBookings.push(b.id);
  }
});

test.afterEach(async () => {
  await db.booking.deleteMany({ where: { id: { in: [extraIds.booking, ...extraIds.extraBookings] } } });
  await db.class.delete({ where: { id: extraIds.class } });
  await db.membership.delete({ where: { id: extraIds.membership } });
  await db.membershipPlan.delete({ where: { id: extraIds.membershipPlan } });
});

test.afterAll(async () => {
  await cleanup();
});

test('the Dashboard shows a real Bookings-this-week/Upcoming count, and "See more" opens the drill-down', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');

  const thisWeekCard = page.getByTestId('stat-bookings');
  const upcomingCard = page.getByTestId('stat-upcoming');
  await expect(thisWeekCard).toContainText('Bookings this week');
  await expect(upcomingCard).toContainText('Upcoming');
  // UPCOMING + NO_SHOW = 2 (the cancelled one is shown apart).
  await expect(thisWeekCard).toContainText('2');
  await expect(thisWeekCard).toContainText('1 cancelled');
  await expect(upcomingCard).toContainText('1');
  await expect(page.getByTestId('attendance-present')).toHaveText('0');
  await expect(page.getByTestId('attendance-absent')).toHaveText('1');

  await page.getByRole('link', { name: /See more/ }).click();
  await expect(page).toHaveURL(/\/bookings-drilldown/);
  await expect(page.locator('.ultm8-badge', { hasText: /^Judo$/ })).toBeVisible();
});

test('the new look: the scope under the title, today\'s classes, and "Needs attention" with the owner\'s notifications', async ({ page }) => {
  const notes = await Promise.all([
    db.notification.create({ data: { id: randomUUID(), userId: s.ownerId, title: 'Waiver signed', body: 'Sam signed the waiver.', targetType: 'WAIVER' } }),
    db.notification.create({ data: { id: randomUUID(), userId: s.ownerId, title: 'Old news', body: 'Already seen.', read: true, readAt: new Date() } }),
  ]);
  try {
    await signIn(page, s.ownerToken);
    await page.goto('/dashboard');

    // DESIGN.md → "Dashboard: nothing shown twice": the line under the title is
    // the Branch scope only; the School's name is on the switcher.
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(page.locator('.u8n-page-header__subtitle')).toHaveText('All Branches');

    // Today's classes come from this week's summary (the fixture Class starts
    // in a few minutes, unless that is already tomorrow in UTC).
    const today = page.getByRole('region', { name: "Today's classes" });
    await expect(today.getByRole('link', { name: 'Open check-in →' })).toHaveAttribute('href', '/check-in');
    if (new Date(classStartMs).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)) {
      const row = today.getByTestId('today-class').filter({ hasText: 'Dashboard Spec Judo' });
      await expect(row).toContainText('2 booked');
    }

    // The right panel: the owner's own inbox, one unread, each opening what it is about.
    const panel = page.getByRole('complementary', { name: 'Needs attention' });
    await expect(panel.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await expect(panel).toContainText('1 unread');
    await expect(panel.getByRole('link', { name: 'Waiver signed' })).toHaveAttribute('href', '/waivers');
    await expect(panel).toContainText('Sam signed the waiver.');
    await expect(panel).toContainText('Old news');
    await panel.getByRole('link', { name: 'See all notifications ›' }).click();
    await expect(page).toHaveURL(/\/notifications$/);
  } finally {
    await db.notification.deleteMany({ where: { id: { in: notes.map((n) => n.id) } } });
  }
});

test('on a phone the number cards and lists come first, "Needs attention" below them', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');
  const stats = page.getByRole('region', { name: 'Bookings this week' });
  const panel = page.getByRole('complementary', { name: 'Needs attention' });
  await expect(stats).toBeVisible();
  await expect(panel).toBeVisible();
  const [a, b] = await Promise.all([stats.boundingBox(), panel.boundingBox()]);
  expect(b!.y).toBeGreaterThan(a!.y + a!.height);
  // No sideways scrolling at phone width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('the drill-down page groups the Booking under its Class\'s activity tag, on the right day, with the right counts', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/bookings-drilldown');

  // The one activity-tag row this fixture produces: 2 Bookings (upcoming +
  // no-show), 1 Upcoming.
  const judoRow = page.locator('li', { has: page.locator('.ultm8-badge', { hasText: /^Judo$/ }) });
  await expect(judoRow).toContainText('2 bookings · 1 upcoming');
  // Decision 367 (Q4): the Class itself is listed, linking to its page.
  const classLink = page.getByRole('link', { name: 'Dashboard Spec Judo' });
  await expect(classLink).toBeVisible();
  await expect(page.locator('li', { has: classLink })).toContainText('2 booked · 1 cancelled');
  await classLink.click();
  await expect(page).toHaveURL(new RegExp(`/classes/${extraIds.class}$`));
});

test.describe('in São Paulo', () => {
  test.use({ timezoneId: 'America/Sao_Paulo', locale: 'en-US' });

  test('Decision 367 (D1): each day is labelled with its own date, not the day before', async ({ page }) => {
    await signIn(page, s.ownerToken);
    await page.goto('/bookings-drilldown');
    const expected = new Date(classStartMs).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const card = page.locator('.ultm8-card', { has: page.getByRole('link', { name: 'Dashboard Spec Judo' }) });
    await expect(card.getByRole('heading', { level: 2 })).toHaveText(expected);
  });
});

test('Decision 367 (D2, D4, D9): a wrong range gets a message instead of a request, and a good one is kept in the address', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/bookings-drilldown');
  await expect(page.getByLabel('From')).not.toHaveValue('');

  const summaryRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/bookings/summary')) summaryRequests.push(r.url());
  });

  await page.getByLabel('From').fill('2026-03-10');
  await page.getByLabel('To').fill('2026-03-01');
  await expect(page.getByRole('alert')).toHaveText('"From" must be on or before "To".');
  await page.getByLabel('To').fill('2026-12-31');
  await expect(page.getByRole('alert')).toHaveText('Choose at most 92 days.');
  await page.getByLabel('To').fill('2026-03-12');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page).toHaveURL(/from=2026-03-10&to=2026-03-12/);
  // Only the good range was asked for.
  await expect.poll(() => summaryRequests.length).toBeGreaterThan(0);
  expect(summaryRequests.every((u) => u.includes('from=2026-03-10&to=2026-03-12'))).toBe(true);

  await page.reload();
  await expect(page.getByLabel('From')).toHaveValue('2026-03-10');
  await expect(page.getByLabel('To')).toHaveValue('2026-03-12');
});

test('narrowing the date range to a day with no Bookings shows the empty state', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/bookings-drilldown');
  // Wait for the fields to populate from the API's own default range before
  // overwriting them, same as waiting for any other async-loaded form.
  await expect(page.getByLabel('From')).not.toHaveValue('');

  const farPast = '2020-01-06'; // a Monday, guaranteed to hold none of this test's fixtures
  await page.getByLabel('From').fill(farPast);
  await page.getByLabel('To').fill(farPast);

  await expect(page.getByText('No Bookings in this range')).toBeVisible();
});

test('Decision 367 (Q5): with two Branches the Owner can narrow the Dashboard to one, and "See more" keeps it', async ({ page }) => {
  const branches = await Promise.all(
    ['Dashboard North', 'Dashboard South'].map((name) => db.branch.create({ data: { id: randomUUID(), schoolId: s.schoolId, name } })),
  );
  try {
    await signIn(page, s.ownerToken);
    await page.goto('/dashboard');
    const thisWeekCard = page.getByTestId('stat-bookings');
    await expect(thisWeekCard).toContainText('2');
    // The picker shows the scope, so the line under the title doesn't repeat it.
    await expect(page.locator('.u8n-page-header__subtitle')).toHaveCount(0);

    // Our own drop-down (DESIGN.md → "Drop-downs"), not the browser's.
    const picker = page.getByRole('combobox', { name: 'Branch' });
    await expect(picker).toHaveText(/All Branches/);
    await picker.click();
    await page.getByRole('option', { name: 'Dashboard North' }).click();
    await expect(picker).toHaveText(/Dashboard North/);
    await expect(page).toHaveURL(new RegExp(`branch=${branches[0].id}`));
    // The fixture Class has no Branch, so one Branch's figures are empty.
    await expect(thisWeekCard).toContainText('0');

    await page.getByRole('link', { name: /See more/ }).click();
    await expect(page).toHaveURL(new RegExp(`/bookings-drilldown\\?branch=${branches[0].id}`));
    // The address changes a moment before the Bookings page replaces the
    // Dashboard, whose own Branch picker (a button, not a field) has the same
    // name; wait for the Bookings page before reading its field.
    await expect(page.getByRole('heading', { level: 1, name: 'Bookings' })).toBeVisible();
    await expect(page.getByLabel('Branch')).toHaveValue(branches[0].id);
  } finally {
    await db.branch.deleteMany({ where: { id: { in: branches.map((b) => b.id) } } });
  }
});

test('Decision 374: Active students, the setup checklist (hide and show again) and this week\'s birthdays', async ({ page }) => {
  const now = new Date();
  await db.user.update({ where: { id: s.student.id }, data: { dateOfBirth: new Date(Date.UTC(2014, now.getUTCMonth(), now.getUTCDate())) } });
  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');

  // The fixture student holds a live Subscription.
  await expect(page.getByTestId('stat-active')).toContainText('Active students');
  await expect(page.getByTestId('stat-active')).toContainText('1');

  // The fixture School has a style with belts, a class and a plan: 3 of 7.
  const checklist = page.getByRole('region', { name: 'Get your School ready' });
  await expect(checklist).toContainText('3 of 7 done');
  await expect(checklist.locator('[data-step="WAIVER"]')).toHaveAttribute('data-done', 'false');
  await expect(checklist.getByRole('link', { name: 'Add a waiver' })).toHaveAttribute('href', '/waivers');
  // Decision 441 item 6: the owner connects Stripe from the School page.
  await expect(checklist.locator('[data-step="STRIPE"]')).toContainText("Connect it on your School profile. It's ticked once Stripe confirms your account is ready.");
  await expect(checklist.getByRole('link', { name: 'Connect Stripe' })).toHaveAttribute('href', '/school#stripe-connect');
  await checklist.getByRole('button', { name: 'Hide' }).click();
  await expect(checklist).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Show the setup checklist' }).click();
  await expect(page.getByRole('region', { name: 'Get your School ready' })).toBeVisible();

  // Birthday today, shown as "Today", with no age.
  const birthdays = page.getByRole('region', { name: 'Birthdays this week' });
  await expect(birthdays).toContainText('Today');
  await expect(birthdays.getByRole('link', { name: s.student.name })).toHaveAttribute('href', `/students/${s.student.id}`);
  await expect(birthdays).not.toContainText('2014');
});

test('Decision 374: a coach sees this week\'s birthdays on the coach dashboard', async ({ page }) => {
  const now = new Date();
  await db.user.update({ where: { id: s.student.id }, data: { dateOfBirth: new Date(Date.UTC(2014, now.getUTCMonth(), now.getUTCDate())) } });
  const coach = await addPerson('Cory', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await signIn(page, coach.token);
  await page.goto('/coach');
  const birthdays = page.getByRole('region', { name: 'Birthdays this week' });
  await expect(birthdays).toContainText(s.student.name);
  await expect(birthdays.getByRole('link')).toHaveCount(0);
});

/** Screenshots for the PR, only when NEW_LOOK_SHOTS names a folder. */
test.describe('screenshots', () => {
  test.skip(!process.env.NEW_LOOK_SHOTS, 'set NEW_LOOK_SHOTS to a folder to take them');

  async function shot(browser: Browser, name: string, opts: { width: number; height: number; dark?: boolean }) {
    const context = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 2, colorScheme: opts.dark ? 'dark' : 'light' });
    const page = await context.newPage();
    await signIn(page, s.ownerToken);
    await page.goto('/dashboard');
    await expect(page.getByRole('complementary', { name: 'Needs attention' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${process.env.NEW_LOOK_SHOTS}/${name}.png`, fullPage: true });
    await context.close();
  }

  test('owner: light, dark and phone', async ({ browser }) => {
    test.setTimeout(120_000);
    mkdirSync(process.env.NEW_LOOK_SHOTS!, { recursive: true });
    const notes = await Promise.all([
      db.notification.create({ data: { id: randomUUID(), userId: s.ownerId, title: 'Waiver signed', body: 'Sam signed the waiver.', targetType: 'WAIVER' } }),
      db.notification.create({ data: { id: randomUUID(), userId: s.ownerId, title: 'Class cancelled', body: 'Dashboard Spec Judo was cancelled.', read: true, readAt: new Date() } }),
    ]);
    try {
      await shot(browser, 'owner-light', { width: 1440, height: 900 });
      await shot(browser, 'owner-dark', { width: 1440, height: 900, dark: true });
      await shot(browser, 'owner-tablet', { width: 820, height: 1180 });
      await shot(browser, 'owner-phone', { width: 390, height: 844 });
      await shot(browser, 'owner-phone-dark', { width: 390, height: 844, dark: true });
    } finally {
      await db.notification.deleteMany({ where: { id: { in: notes.map((n) => n.id) } } });
    }
  });
});
