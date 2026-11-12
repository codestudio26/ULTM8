import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';
import { pickOption } from './team-helpers';

/**
 * The last pages still on the old page header take the new look (Decision
 * 460 item 17): a class's Show QR and Roll call, the Dashboard's Bookings
 * drill-down, Membership Plans (its "owner only" message, shared with the plan
 * form and a plan's Members page), a plan's Members page and What's new. Look
 * only: the same data, buttons and checks, which each page's own specs still
 * cover. Each page is checked for whoever may open it.
 */
let s: GradingSchool;
const HOUR = 3_600_000;
const postIds: string[] = [];

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.booking.deleteMany({ where });
  await db.rosterMember.deleteMany({ where });
  await db.roster.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
  await db.class.deleteMany({ where });
});

test.afterAll(async () => {
  await db.productUpdate.deleteMany({ where: { id: { in: postIds } } });
  await cleanup();
});

/** The new header, with nothing of the old page look left in the page. */
async function expectNewLook(page: Page, title: string | RegExp) {
  const header = page.locator('.u8n-page-header');
  await expect(header.getByRole('heading', { level: 1, name: title })).toBeVisible();
  const main = page.locator('.u8n-content');
  await expect(main.locator('.ultm8-page-header, .ultm8-card, select')).toHaveCount(0);
}

async function fitsTheScreen(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

async function classWithBooking(data: Record<string, unknown> = {}) {
  const cls = await db.class.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      title: 'Evening BJJ',
      activities: ['BJJ'],
      styles: [{ disciplineId: s.disciplineId, classType: null }],
      startDate: new Date(Date.now() - 10 * 60_000),
      endDate: new Date(Date.now() + HOUR),
      ...data,
    },
  });
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
  const m = await db.membership.create({ data: { id: randomUUID(), studentId: s.student.id, schoolId: s.schoolId, membershipPlanId: plan.id, frequency: 'RECURRING' } });
  await db.booking.create({ data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: m.id } });
  return { cls, plan };
}

test.describe('the owner', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, s.ownerToken);
  });

  test('Show QR: the new header and a white card with the code and the typed code', async ({ page }) => {
    const { cls } = await classWithBooking();
    await page.goto(`/classes/${cls.id}/qr-code`);
    await expectNewLook(page, 'QR check-in — Evening BJJ');
    const card = page.locator('.u8at-qr');
    await expect(card.locator('svg').first()).toBeVisible();
    await expect(card.getByText(/^\d{6}$/)).toBeVisible();
  });

  test('Roll call: the new header, our own roster drop-down, new-look rows and tags', async ({ page }) => {
    const { cls } = await classWithBooking();
    await db.roster.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'Competition team' } });
    await page.goto(`/classes/${cls.id}/roll-call`);
    await expectNewLook(page, 'Roll call — Evening BJJ');
    const row = page.getByTestId('roll-call').getByRole('listitem').filter({ hasText: s.student.name });
    await expect(row.getByRole('button', { name: 'Scan', exact: true })).toBeVisible();

    // The roster filter: our drop-down; a roster with nobody on it empties the list.
    await pickOption(page, 'Roster', 'Competition team');
    await expect(page.getByTestId('roll-call')).toHaveCount(0);
    await pickOption(page, 'Roster', 'Everyone booked');
    await expect(row).toBeVisible();

    // Confirm present: the same check-in, then a mint "Present" tag.
    await row.getByRole('button', { name: 'Confirm present' }).click();
    await expect(row.locator('.u8s-tag--mint')).toHaveText('Present ✓');
    await expect(row).toContainText('Confirmed by you');
    await expect(page.locator('.u8n-content .ultm8-badge')).toHaveCount(0);
  });

  test('Bookings drill-down: the new header, white day cards and our own Branch drop-down', async ({ page }) => {
    await addBranch(s, 'North');
    await addBranch(s, 'South');
    await classWithBooking({ startDate: new Date(Date.now() + HOUR), endDate: new Date(Date.now() + 2 * HOUR) });
    await page.goto('/bookings-drilldown');
    await expectNewLook(page, 'Bookings');
    await expect(page.getByTestId('bookings-day').filter({ has: page.getByRole('link', { name: 'Evening BJJ' }) })).toBeVisible();
    await pickOption(page, 'Branch', 'North');
    await expect(page).toHaveURL(/branch=/);
    await expect(page.getByText('No Bookings in this range')).toBeVisible();
  });

  test("a plan's Members page: the new header with its way back, a members table and the waiting list card", async ({ page }) => {
    const plan = await db.membershipPlan.create({
      data: { id: randomUUID(), schoolId: s.schoolId, type: 'WEEKLY_PASS', title: 'Small group', price: 2000, currency: 'GBP', expiryDurationDays: 30, memberLimit: 1 },
    });
    await db.membership.create({ data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: plan.id, schoolId: s.schoolId, frequency: 'ONE_TIME' } });
    await page.goto(`/membership-plans/${plan.id}/members`);
    await expectNewLook(page, 'Members of Small group');
    await expect(page.getByTestId('plan-members').getByRole('link', { name: s.student.name })).toBeVisible();
    await expect(page.locator('.u8b-card').filter({ has: page.getByRole('heading', { level: 2, name: 'Waiting list' }) })).toBeVisible();
    await expect(page.getByTestId('plan-places')).toHaveText('1 of 1 places taken');
    await page.locator('.u8n-page-header__parent').click();
    await expect(page).toHaveURL(/\/membership-plans$/);
    await expectNewLook(page, 'Membership Plans');
  });

  test("What's new: the new header and a white card per post", async ({ page }) => {
    const post = await db.productUpdate.create({ data: { id: randomUUID(), title: `Roll call ${randomUUID().slice(0, 6)}`, body: 'Faster check-in.', createdById: randomUUID() } });
    postIds.push(post.id);
    await page.goto('/whats-new');
    await expectNewLook(page, "What's new");
    await expect(page.locator('.u8b-card').filter({ has: page.getByTestId('whats-new-post').filter({ hasText: post.title }) })).toBeVisible();
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('every page fits: nothing scrolls sideways and the plan members become cards', async ({ page }) => {
    await signIn(page, s.ownerToken);
    const { cls, plan } = await classWithBooking();
    await page.goto(`/classes/${cls.id}/qr-code`);
    await expect(page.locator('.u8at-qr svg').first()).toBeVisible();
    expect(await fitsTheScreen(page)).toBe(true);

    await page.goto(`/classes/${cls.id}/roll-call`);
    await expect(page.getByRole('button', { name: 'Confirm present' })).toBeVisible();
    expect(await fitsTheScreen(page)).toBe(true);

    await page.goto('/bookings-drilldown');
    await expect(page.getByTestId('bookings-day').first()).toBeVisible();
    expect(await fitsTheScreen(page)).toBe(true);

    await page.goto(`/membership-plans/${plan.id}/members`);
    await expect(page.getByTestId('plan-members')).toHaveAttribute('data-layout', 'cards');
    expect(await fitsTheScreen(page)).toBe(true);

    await page.goto('/membership-plans');
    await expect(page.locator('.u8n-page-header')).toBeVisible();
    expect(await fitsTheScreen(page)).toBe(true);

    await page.goto('/whats-new');
    await expect(page.locator('.u8n-page-header')).toBeVisible();
    expect(await fitsTheScreen(page)).toBe(true);
  });
});

test('a coach opens roll call and Show QR for their own class in the new look', async ({ page }) => {
  const coach = await addPerson('Cody', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  const { cls } = await classWithBooking({ instructorId: coach.id });
  await signIn(page, coach.token);
  await page.goto(`/classes/${cls.id}/roll-call`);
  await expectNewLook(page, 'Roll call — Evening BJJ');
  await expect(page.getByRole('button', { name: 'Confirm present' })).toBeVisible();
  await page.goto(`/classes/${cls.id}/qr-code`);
  await expectNewLook(page, 'QR check-in — Evening BJJ');
  await expect(page.locator('.u8at-qr').getByText(/^\d{6}$/)).toBeVisible();
});

test("Branch Staff: their branch's roll call, What's new, and the owner-only message on Membership Plans, all in the new look", async ({ page }) => {
  const north = await addBranch(s, 'North');
  const staff = await addPerson('Bly', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  const { cls, plan } = await classWithBooking({ branchId: north.id });
  await signIn(page, staff.token);
  await page.goto(`/classes/${cls.id}/roll-call`);
  await expectNewLook(page, 'Roll call — Evening BJJ');
  await expect(page.getByRole('button', { name: 'Confirm present' })).toBeVisible();

  await page.goto('/whats-new');
  await expectNewLook(page, "What's new");

  // The API lets only the owner manage plans; the list, the form and a
  // plan's Members page say so, in the new look.
  for (const path of ['/membership-plans', '/membership-plans/new', `/membership-plans/${plan.id}/members`]) {
    await page.goto(path);
    await expectNewLook(page, 'Membership Plans');
    await expect(page.locator('.u8b-card').getByText('Only the School owner manages membership plans')).toBeVisible();
  }
});
