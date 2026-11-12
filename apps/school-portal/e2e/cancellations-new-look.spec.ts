import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Cancellations to resolve in the new look (Decision 453). The approved design
 * draws no Cancellations screen, so the page keeps its columns and actions and
 * takes the new header, card, table, tags and pill buttons (the Billing
 * pages' pieces); when the table doesn't fit its card each row becomes a card
 * (Decision 458 item 3). What the actions do is covered by class-cancellations.spec.
 */
let s: GradingSchool;
let branchId: string;

/** A banner for one class (an inline image, so the test needs no network);
 * the other class has none and shows its initials (Decision 458 item 2). */
const BANNER = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#3a6"/></svg>')}`;

async function seedCancelled(resolution: 'PENDING' | 'REFUND_OWED', title: string, extra: { bannerUrl?: string; timetableSlotId?: string; occurrenceDate?: Date } = {}) {
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: '5-Class Pack', price: 3000, classesIncluded: 5, currency: 'GBP' } });
  const membership = await db.membership.create({
    data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: plan.id, schoolId: s.schoolId, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining: 4 },
  });
  const start = new Date(Date.now() + 24 * 3_600_000);
  const cls = await db.class.create({ data: { id: randomUUID(), schoolId: s.schoolId, branchId, title, startDate: start, endDate: new Date(start.getTime() + 3_600_000), ...extra } });
  return db.booking.create({
    data: {
      id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, branchId, sourceMembershipId: membership.id,
      status: 'CANCELLED', refundResolution: resolution, refundAmount: resolution === 'REFUND_OWED' ? 600 : null,
    },
  });
}

test.beforeEach(async () => {
  s = await seedGradingSchool();
  branchId = (await db.branch.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'Riverside' } })).id;
  await seedCancelled('PENDING', 'Evening Open Mat');
  await seedCancelled('REFUND_OWED', 'Saturday Fundamentals', { bannerUrl: BANNER });
});

/** Each row (table or card) leads with its class's avatar: the banner when the
 * class has one, its initials on a soft circle otherwise. */
async function expectAvatars(list: import('@playwright/test').Locator) {
  const pendingAvatar = list.getByRole('row').filter({ hasText: 'Evening Open Mat' }).locator('.u8x-class .u8s-avatar');
  await expect(pendingAvatar).toHaveCount(1);
  await expect(pendingAvatar).toBeVisible();
  await expect(pendingAvatar).toHaveText('EO');
  await expect(pendingAvatar).toHaveClass(/u8s-avatar--c\d/);
  const owedAvatar = list.getByRole('row').filter({ hasText: 'Saturday Fundamentals' }).locator('.u8x-class .u8s-avatar');
  await expect(owedAvatar).toHaveCount(1);
  await expect(owedAvatar).toBeVisible();
  await expect(owedAvatar).toHaveJSProperty('tagName', 'IMG');
  await expect(owedAvatar).toHaveAttribute('src', BANNER);
  // Every body row has exactly one, in front of (left of) the class name.
  const rows = list.locator('tbody tr');
  const count = await rows.count();
  expect(count).toBe(2);
  for (let i = 0; i < count; i++) {
    const avatar = rows.nth(i).locator('.u8s-avatar');
    await expect(avatar).toHaveCount(1);
    const a = (await avatar.boundingBox())!;
    const text = (await rows.nth(i).locator('.u8x-class__text').boundingBox())!;
    expect(a.x + a.width).toBeLessThanOrEqual(text.x);
  }
}

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.booking.deleteMany({ where });
  await db.class.deleteMany({ where });
  await db.timetableSlot.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
  await db.staffPermission.deleteMany({ where });
  await db.branch.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

test('owner: the new header, one card with the table, tags and pill buttons', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/cancellations');
  const header = page.locator('.u8n-page-header');
  await expect(header.getByRole('heading', { name: 'Cancellations to resolve' })).toBeVisible();
  await expect(header).toContainText('Cancelled bookings waiting for a decision');

  const card = page.getByTestId('cancellations-card');
  await expect(card).toHaveClass(/u8b-card/);
  const pending = card.getByRole('row').filter({ hasText: 'Evening Open Mat' });
  await expect(pending.locator('.u8b-name')).toHaveText('Sam Lee');
  await expect(pending.locator('.ultm8-badge')).toHaveText('Needs a decision');
  // Refund is the main action (mint); give credit back and keep are white pills.
  await expect(pending.getByRole('button', { name: 'Refund' })).toHaveClass(/u8b-pill--primary/);
  for (const name of ['Give credit back', 'Keep']) {
    await expect(pending.getByRole('button', { name })).toHaveClass(/u8b-pill/);
    await expect(pending.getByRole('button', { name })).not.toHaveClass(/u8b-pill--primary/);
  }

  const owed = card.getByRole('row').filter({ hasText: 'Saturday Fundamentals' });
  await expect(owed.locator('.ultm8-badge')).toHaveText('Refund owed');
  await expect(owed).toContainText('5-Class Pack');
  await owed.getByRole('button', { name: 'Mark refund paid' }).click();
  await expect(card.getByRole('row').filter({ hasText: 'Saturday Fundamentals' })).toHaveCount(0);
  await expect(card.getByRole('row').filter({ hasText: 'Evening Open Mat' })).toHaveCount(1);
});

test('Branch Staff: no Refund or Mark refund paid, only credit back and keep', async ({ page }) => {
  const staff = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId }]);
  await signIn(page, staff.token);
  await page.goto('/cancellations');
  await expect(page.locator('.u8n-page-header').getByRole('heading', { name: 'Cancellations to resolve' })).toBeVisible();
  const card = page.getByTestId('cancellations-card');

  const pending = card.getByRole('row').filter({ hasText: 'Evening Open Mat' });
  await expect(pending.getByRole('button', { name: 'Give credit back' })).toBeVisible();
  await expect(pending.getByRole('button', { name: 'Keep' })).toBeVisible();
  await expect(pending.getByRole('button', { name: 'Refund' })).toHaveCount(0);

  const owed = card.getByRole('row').filter({ hasText: 'Saturday Fundamentals' });
  await expect(owed).toContainText('Waiting for the owner to pay it back');
  await expect(owed.getByRole('button')).toHaveCount(0);

  await pending.getByRole('button', { name: 'Keep' }).click();
  await expect(card.getByRole('row').filter({ hasText: 'Evening Open Mat' })).toHaveCount(0);
});

test('desktop: a table with column headings while it fits its card', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, s.ownerToken);
  await page.goto('/cancellations');
  const list = page.getByTestId('cancellations-list');
  await expect(list.getByRole('row').filter({ hasText: 'Evening Open Mat' })).toBeVisible();
  await expect(list).toHaveAttribute('data-layout', 'table');
  await expect(list.locator('thead th').filter({ hasText: 'Membership' })).toBeVisible();
  await expectAvatars(list);
  expect(await list.evaluate((el) => el.querySelector('table')!.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

/** Decision 458 item 3: on a phone each row is a card (class, student,
 * status, then the buttons stacked) and nothing scrolls sideways. */
for (const role of ['owner', 'staff'] as const) {
  test(`phone (${role}): each row is a card with the buttons stacked, nothing scrolls sideways`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const token = role === 'owner' ? s.ownerToken : (await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId }])).token;
    await signIn(page, token);
    await page.goto('/cancellations');
    const list = page.getByTestId('cancellations-list');
    const pending = list.getByRole('row').filter({ hasText: 'Evening Open Mat' });
    await expect(pending).toBeVisible();
    await expect(list).toHaveAttribute('data-layout', 'cards');
    await expect(list.locator('thead')).toBeHidden();
    await expectAvatars(list);

    // Class, then student, then status, then the buttons, top to bottom.
    const top = async (selector: string) => (await pending.locator(selector).boundingBox())!.y;
    const [cls, student, status, buttons] = [await top('.u8x-class'), await top('.u8x-student'), await top('.u8x-status'), await top('.u8x-actions')];
    expect(cls).toBeLessThan(student);
    expect(student).toBeLessThan(status);
    expect(status).toBeLessThan(buttons);
    // The plan line keeps its column name in front of it.
    await expect(pending.locator('.u8x-detail').first()).toContainText('Membership');

    const names = role === 'owner' ? ['Refund', 'Give credit back', 'Keep'] : ['Give credit back', 'Keep'];
    await expect(pending.getByRole('button')).toHaveText(names);
    const boxes = await Promise.all(names.map(async (name) => (await pending.getByRole('button', { name, exact: true }).boundingBox())!));
    for (let i = 1; i < boxes.length; i++) {
      expect(Math.abs(boxes[i].x - boxes[0].x)).toBeLessThan(1);
      expect(Math.abs(boxes[i].width - boxes[0].width)).toBeLessThan(1);
      expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y + boxes[i - 1].height - 1);
    }

    const owed = list.getByRole('row').filter({ hasText: 'Saturday Fundamentals' });
    if (role === 'owner') {
      await expect(owed.getByRole('button')).toHaveText(['Mark refund paid']);
    } else {
      await expect(owed).toContainText('Waiting for the owner to pay it back');
      await expect(owed.getByRole('button')).toHaveCount(0);
    }

    expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // The card still works: Keep resolves the row.
    await pending.getByRole('button', { name: 'Keep' }).click();
    await expect(list.getByRole('row').filter({ hasText: 'Evening Open Mat' })).toHaveCount(0);
  });
}

test('nothing to resolve: the empty state sits inside the card', async ({ page }) => {
  await db.booking.deleteMany({ where: { schoolId: s.schoolId } });
  await signIn(page, s.ownerToken);
  await page.goto('/cancellations');
  await expect(page.getByTestId('cancellations-card').getByText('Nothing to resolve')).toBeVisible();
});

/** Decision 458 item 2: the avatar's colour follows the class's timetable
 * slot, as on the Classes and Timetable pages, so two dates of one slot match. */
test('two dates of one timetable slot share the avatar colour', async ({ page }) => {
  await db.booking.deleteMany({ where: { schoolId: s.schoolId } });
  const slot = await db.timetableSlot.create({
    data: { id: randomUUID(), schoolId: s.schoolId, branchId, weekday: 'TUESDAY', startTime: new Date(Date.UTC(1970, 0, 1, 18, 0)), endTime: new Date(Date.UTC(1970, 0, 1, 19, 0)), title: 'Kids Judo' },
  });
  await seedCancelled('PENDING', 'Kids Judo', { timetableSlotId: slot.id, occurrenceDate: new Date(Date.UTC(2030, 0, 1)) });
  await seedCancelled('REFUND_OWED', 'Kids Judo', { timetableSlotId: slot.id, occurrenceDate: new Date(Date.UTC(2030, 0, 8)) });
  await signIn(page, s.ownerToken);
  await page.goto('/cancellations');
  const avatars = page.getByTestId('cancellations-list').locator('tbody tr .u8s-avatar');
  await expect(avatars).toHaveCount(2);
  await expect(avatars).toHaveText(['KJ', 'KJ']);
  const colours = await avatars.evaluateAll((els) => els.map((el) => [...el.classList].find((c) => /^u8s-avatar--c\d$/.test(c))));
  expect(colours[0]).toBeTruthy();
  expect(colours[1]).toBe(colours[0]);
});
