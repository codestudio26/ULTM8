import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 291 — the School page's "Class cancellations" settings, the
 * Cancellations to resolve page, and the Cancel class button.
 */
let s: GradingSchool;

async function seedCancelledBooking(resolution: 'PENDING' | 'REFUND_OWED') {
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: '5-Class Pack', price: 3000, classesIncluded: 5, currency: 'GBP' } });
  const membership = await db.membership.create({
    data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: plan.id, schoolId: s.schoolId, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining: 4 },
  });
  const start = new Date(Date.now() + 24 * 3_600_000);
  const cls = await db.class.create({ data: { id: randomUUID(), schoolId: s.schoolId, title: 'Evening Open Mat', startDate: start, endDate: new Date(start.getTime() + 3_600_000) } });
  await db.booking.create({
    data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: membership.id, status: 'CANCELLED', refundResolution: resolution, refundAmount: resolution === 'REFUND_OWED' ? 600 : null },
  });
  return { membership, cls };
}

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterEach(async () => {
  await db.booking.deleteMany({ where: { schoolId: s.schoolId } });
  await db.waitlistEntry.deleteMany({ where: { schoolId: s.schoolId } });
  await db.class.deleteMany({ where: { schoolId: s.schoolId } });
  await db.transaction.deleteMany({ where: { schoolId: s.schoolId } });
  await db.membership.deleteMany({ where: { schoolId: s.schoolId } });
  await db.membershipPlan.deleteMany({ where: { schoolId: s.schoolId } });
});

test.afterAll(async () => {
  await cleanup();
});

test('the owner chooses the class cancellation settings on the School page', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/school');
  const card = page.locator('form').filter({ hasText: 'Class cancellations' });
  await card.getByLabel('Class cancellation policy').selectOption('AUTO_REFUND');
  await card.getByLabel('When the policy applies').selectOption('ANY_TIME');
  await card.getByLabel('Default cutoff (hours before class)').fill('12');
  await card.getByLabel("Charge the class's late-cancellation fee after the cutoff").uncheck();
  await card.getByLabel('No-show fee').fill('500');
  await card.getByLabel('When the school cancels a whole class').selectOption('FOLLOW_POLICY');
  await card.getByRole('button', { name: 'Save changes' }).click();

  await expect(card.getByText('Saved.')).toBeVisible();
  const school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(school).toMatchObject({
    classCancellationPolicy: 'AUTO_REFUND',
    classCancellationPolicyWindow: 'ANY_TIME',
    defaultRefundCutoffHours: 12,
    chargeLateCancellationFee: false,
    noShowFee: 500,
    schoolCancelledClassResolution: 'FOLLOW_POLICY',
  });
});

test('Cancellations to resolve: the owner gives a class credit back', async ({ page }) => {
  const { membership } = await seedCancelledBooking('PENDING');
  await signIn(page, s.ownerToken);
  await page.goto('/cancellations');
  await expect(page.getByRole('heading', { name: 'Cancellations to resolve' })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Sam Lee' });
  await expect(row).toContainText('Evening Open Mat');
  await expect(row).toContainText('Needs a decision');
  await row.getByRole('button', { name: 'Give credit back' }).click();

  await expect(page.getByText('Nothing to resolve')).toBeVisible();
  expect((await db.membership.findUniqueOrThrow({ where: { id: membership.id } })).classesRemaining).toBe(5);
});

test('the owner cancels a whole class with a reason', async ({ page }) => {
  const start = new Date(Date.now() + 24 * 3_600_000);
  const cls = await db.class.create({ data: { id: randomUUID(), schoolId: s.schoolId, title: 'Saturday Fundamentals', startDate: start, endDate: new Date(start.getTime() + 3_600_000) } });
  await signIn(page, s.ownerToken);
  await page.goto(`/classes/${cls.id}`);
  await page.getByRole('button', { name: 'Cancel class' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason (optional)').fill('Coach is ill');
  await dialog.getByRole('button', { name: 'Cancel class' }).click();

  await expect(page.getByText('Cancelled by the school')).toBeVisible();
  await expect(page.getByText('Reason: Coach is ill')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel class' })).toHaveCount(0);
  const after = await db.class.findUniqueOrThrow({ where: { id: cls.id } });
  expect(after.cancellationReason).toBe('Coach is ill');
});
