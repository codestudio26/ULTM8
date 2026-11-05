import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 316 item 6: the owner writes a plan's contract (text, minimum
 * term, early-exit fee) on the plan's edit page, and sees a Student's signed
 * contracts, with the exact text signed, on the Student's page.
 */
let s: GradingSchool;
const planIds: string[] = [];

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await db.school.update({ where: { id: s.schoolId }, data: { defaultCurrency: 'GBP' } });
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  await db.planContractSignature.deleteMany({ where: { schoolId: s.schoolId } });
  await db.membershipPlan.deleteMany({ where: { id: { in: planIds } } });
  planIds.length = 0;
});

test.afterAll(async () => {
  await cleanup();
});

test('the owner writes a Subscription contract with a minimum term and an early-exit fee', async ({ page }) => {
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: 'Monthly Unlimited', price: 5000, currency: 'GBP' },
  });
  planIds.push(plan.id);
  await page.goto(`/membership-plans/${plan.id}/edit`);
  const card = page.getByRole('form', { name: 'Contract' });
  await expect(card.getByText('This plan has no contract.')).toBeVisible();
  await card.getByLabel('Contract text').fill('Twelve months, then month to month.');
  await card.getByLabel('Minimum term (months)').fill('12');
  await card.getByLabel('Early-exit fee').fill('50');
  await card.getByRole('button', { name: 'Add contract' }).click();
  await expect(card.getByText('Version 1')).toBeVisible();
  const saved = await db.membershipPlan.findUniqueOrThrow({ where: { id: plan.id } });
  expect(saved).toMatchObject({ contractBody: 'Twelve months, then month to month.', contractMinimumTermMonths: 12, contractEarlyExitFee: 5000, contractVersion: 1 });
});

test('a Class Pack contract has no term or fee fields', async ({ page }) => {
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: 'Ten classes', price: 6000, currency: 'GBP', classesIncluded: 10 },
  });
  planIds.push(plan.id);
  await page.goto(`/membership-plans/${plan.id}/edit`);
  const card = page.getByRole('form', { name: 'Contract' });
  await expect(card.getByText('A minimum term and an early-exit fee are for Subscription plans.')).toBeVisible();
  await expect(card.getByLabel('Minimum term (months)')).toHaveCount(0);
});

test("the Student's page lists their signed contracts with the exact text signed", async ({ page }) => {
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: 'Annual', price: 4000, currency: 'GBP', contractBody: 'Signed words.', contractVersion: 1, contractMinimumTermMonths: 12, contractEarlyExitFee: 5000 },
  });
  planIds.push(plan.id);
  await db.planContractSignature.create({
    data: {
      id: randomUUID(), schoolId: s.schoolId, membershipPlanId: plan.id, studentId: s.student.id, signedById: s.student.id,
      signerFullName: 'Sam Student', signatureText: 'Sam Student', planTitle: 'Annual', planType: 'SUBSCRIPTION', contractBody: 'Signed words.',
      minimumTermMonths: 12, earlyExitFee: 5000, currency: 'GBP', contractVersion: 1, contractSha256: 'a'.repeat(64), usedAt: new Date(),
    },
  });
  await page.goto(`/students/${s.student.id}`);
  await expect(page.getByRole('heading', { name: 'Signed contracts' })).toBeVisible();
  await expect(page.getByText(/Minimum term 12 months · early-exit fee 50\.00 GBP/)).toBeVisible();
  await page.getByRole('button', { name: 'Show the signed text' }).click();
  await expect(page.getByText('Signed words.')).toBeVisible();
  await expect(page.getByText('Typed signature: Sam Student')).toBeVisible();
});
