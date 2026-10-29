import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 404 (backlog 3.4) — freezing a membership, the owner's side: the
 * Freeze button and dialog on a Student's Memberships card, ending a freeze,
 * a member's request approved from the Students page, the Frozen badge and
 * filter, and the School's settings. Cash-paid Weekly Passes only: a card
 * Subscription's Stripe call is covered by the API test
 * (apps/api/test/membership-freeze.e2e-spec.ts), which stubs Stripe.
 */
let s: GradingSchool;

const DAY = 24 * 60 * 60 * 1000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

async function weeklyPass(studentId: string) {
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, title: 'Four weeks', type: 'WEEKLY_PASS', price: 4000, currency: 'GBP', expiryDurationDays: 28 },
  });
  return db.membership.create({
    data: { id: randomUUID(), studentId, membershipPlanId: plan.id, schoolId: s.schoolId, frequency: 'ONE_TIME', expiryDate: new Date(Date.now() + 20 * DAY) },
  });
}

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.membershipFreeze.deleteMany({ where });
  await db.transaction.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

test('the owner freezes a Weekly Pass from the Student page, sees it frozen, and ends it', async ({ page }) => {
  const m = await weeklyPass(s.student.id);
  await page.goto(`/students/${s.student.id}`);
  const row = page.getByRole('row', { name: /Four weeks/ });
  await row.getByRole('button', { name: 'Freeze', exact: true }).click();

  const dialog = page.getByTestId('freeze-modal');
  await expect(page.getByRole('heading', { name: /Freeze Four weeks for/ })).toBeVisible();
  await expect(dialog.getByText('Most frozen days in any 12 months at this School: 90.')).toBeVisible();
  // Too short: the API's rule, in the portal's words.
  await page.getByLabel('First frozen day').fill(day(0));
  await page.getByLabel('Back on').fill(day(3));
  await dialog.getByRole('button', { name: 'Freeze membership' }).click();
  await expect(page.getByText('A freeze must last at least 7 days.')).toBeVisible();

  await page.getByLabel('Back on').fill(day(10));
  await dialog.getByRole('button', { name: 'Freeze membership' }).click();
  await expect(row).toContainText(/Frozen until/);
  await expect(row.getByRole('button', { name: 'Freeze', exact: true })).toHaveCount(0);
  // The expiry date moved later by the 10 frozen days.
  const moved = await db.membership.findUniqueOrThrow({ where: { id: m.id } });
  expect(moved.expiryDate!.getTime()).toBe(m.expiryDate!.getTime() + 10 * DAY);

  await row.getByRole('button', { name: 'End freeze' }).click();
  await expect(page.getByRole('heading', { name: 'End this freeze?' })).toBeVisible();
  await page.getByRole('button', { name: 'End freeze', exact: true }).last().click();
  await expect(row).toContainText('Active');
  await expect(row.getByRole('button', { name: 'Freeze', exact: true })).toBeVisible();
});

test('a member\'s request shows on the Students page; approving it marks them Frozen in the list and the filter', async ({ page }) => {
  const m = await weeklyPass(s.student.id);
  await weeklyPass(s.newStudent.id);
  await db.membershipFreeze.create({
    data: {
      id: randomUUID(), membershipId: m.id, schoolId: s.schoolId, studentId: s.student.id, status: 'REQUESTED', requestedById: s.student.id,
      startsAt: new Date(`${day(0)}T00:00:00.000Z`), endsAt: new Date(`${day(8)}T00:00:00.000Z`),
    },
  });

  await page.goto('/students');
  const requests = page.getByTestId('freeze-requests');
  await expect(page.getByRole('heading', { name: 'Freeze requests' })).toBeVisible();
  await expect(requests).toContainText('wants to freeze Four weeks');
  await requests.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('heading', { name: 'Freeze requests' })).toHaveCount(0);

  const frozenRow = page.getByRole('row', { name: /Sam Lee/ });
  await expect(frozenRow.getByText('Frozen', { exact: true })).toBeVisible();
  await page.getByLabel('Frozen only').check();
  await expect(page.getByRole('row', { name: /Sam Lee/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Nia Park/ })).toHaveCount(0);
});

test('a request can be declined on the Student page', async ({ page }) => {
  const m = await weeklyPass(s.student.id);
  const freeze = await db.membershipFreeze.create({
    data: {
      id: randomUUID(), membershipId: m.id, schoolId: s.schoolId, studentId: s.student.id, status: 'REQUESTED', requestedById: s.student.id,
      startsAt: new Date(`${day(2)}T00:00:00.000Z`), endsAt: new Date(`${day(12)}T00:00:00.000Z`),
    },
  });
  await page.goto(`/students/${s.student.id}`);
  const row = page.getByRole('row', { name: /Four weeks/ });
  await expect(row).toContainText(/Freeze requested/);
  await row.getByRole('button', { name: 'Decline' }).click();
  await expect(row).toContainText('Active');
  expect((await db.membershipFreeze.findUniqueOrThrow({ where: { id: freeze.id } })).status).toBe('DECLINED');
});

test('the owner sets the freezing limit and fee on the School page, and lets frozen members check in', async ({ page }) => {
  await page.goto('/school');
  const card = page.getByTestId('freeze-settings');
  await expect(page.getByRole('heading', { name: 'Freezing memberships' })).toBeVisible();
  await card.getByLabel('Most frozen days in any 12 months').fill('60');
  await card.getByLabel('Freeze fee').fill('12.50');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByText('Saved')).toBeVisible();
  const school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(school).toMatchObject({ freezeMaxDaysPer12Months: 60, freezeFeeAmount: 1250 });

  await card.getByRole('link', { name: 'Open check-in rules' }).click();
  await expect(page).toHaveURL(/\/check-in\/rules$/);
  await page.getByLabel('Allow frozen members to check in').check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Check-in rules saved.')).toBeVisible();
  expect((await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).checkInFrozenMembers).toBe(true);
});
