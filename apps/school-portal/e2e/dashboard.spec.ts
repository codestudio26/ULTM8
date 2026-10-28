import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
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

  const thisWeekCard = page.locator('.ultm8-card', { hasText: 'Bookings this week' });
  const upcomingCard = page.locator('.ultm8-card', { hasText: 'Upcoming' });
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
    const thisWeekCard = page.locator('.ultm8-card', { hasText: 'Bookings this week' });
    await expect(thisWeekCard).toContainText('2');

    await page.getByLabel('Branch').selectOption({ label: 'Dashboard North' });
    await expect(page).toHaveURL(new RegExp(`branch=${branches[0].id}`));
    // The fixture Class has no Branch, so one Branch's figures are empty.
    await expect(thisWeekCard).toContainText('0');

    await page.getByRole('link', { name: /See more/ }).click();
    await expect(page).toHaveURL(new RegExp(`/bookings-drilldown\\?branch=${branches[0].id}`));
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
  await expect(page.locator('.ultm8-card', { hasText: 'Active students' })).toContainText('1');

  // The fixture School has a style with belts, a class and a plan: 3 of 7.
  const checklist = page.getByRole('region', { name: 'Get your School ready' });
  await expect(checklist).toContainText('3 of 7 done');
  await expect(checklist.locator('[data-step="WAIVER"]')).toHaveAttribute('data-done', 'false');
  await expect(checklist.getByRole('link', { name: 'Add a waiver' })).toHaveAttribute('href', '/waivers');
  await expect(checklist.locator('[data-step="STRIPE"]')).toContainText('ULTM8 support connects your Stripe account');
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
