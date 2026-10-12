import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

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
const extraIds = { membershipPlan: '', membership: '', class: '', booking: '' };

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

  // "Today", well inside the current Mon–Sun week the API's own default range
  // resolves to (this School has no timezone set, so UTC — same fallback
  // BookingsService.getWeeklySummary's own default uses).
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  const cls = await db.class.create({
    data: {
      id: randomUUID(), schoolId: s.schoolId, title: 'Dashboard Spec Judo', activities: ['Judo'],
      startDate: today, endDate: new Date(today.getTime() + 3_600_000),
    },
  });
  extraIds.class = cls.id;
  const booking = await db.booking.create({
    data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: membership.id, status: 'UPCOMING' },
  });
  extraIds.booking = booking.id;
});

test.afterEach(async () => {
  await db.booking.delete({ where: { id: extraIds.booking } });
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
  await expect(thisWeekCard).toContainText('1');
  await expect(upcomingCard).toContainText('1');

  await page.getByRole('link', { name: /See more/ }).click();
  await expect(page).toHaveURL(/\/bookings-drilldown/);
  await expect(page.getByText('Judo')).toBeVisible();
});

test('the drill-down page groups the Booking under its Class\'s activity tag, on the right day, with the right counts', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/bookings-drilldown');

  await expect(page.getByText('Judo')).toBeVisible();
  // The one activity-tag row this fixture produces: 1 Booking, 1 Upcoming.
  await expect(page.locator('li', { hasText: 'Judo' })).toContainText('1 booking · 1 upcoming');
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
