import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Paying a promotion fee as a charge (v1.3 backlog §3.6 step 6; Decision 303
 * item 5), the owner's side: an accepted fee's charge on the student's
 * Payments card ("Promotion fee", the style and grade, a link to grading, and
 * no Cancel: it is waived or cancelled from grading), the style's fee list in
 * grading with the invoice, waiving the fee from grading, which cancels the
 * charge, and a fee paid after the student's rank changed (its promotion
 * can't apply, Decision 414 item 1): shown as such, grading not held up, and
 * Cancel fee giving the money back as credit. The fee is accepted in the student app, so the request and its
 * charge are written straight to the database here; the rules are covered by
 * the API test (apps/api/test/promotion-fee-charges.e2e-spec.ts).
 */
let s: GradingSchool;
let requestId: string;
let chargeId: string;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await db.school.update({ where: { id: s.schoolId }, data: { defaultCurrency: 'GBP', promotionFeeEnabled: true } });
  await db.paymentAccount.create({ data: { id: randomUUID(), schoolId: s.schoolId, provider: 'CASH', accountTitle: 'Desk', country: 'GB' } });
  const today = new Date().toISOString().slice(0, 10);
  requestId = randomUUID();
  // The student (White 1) was graded to White 2, priced 18.00; the promotion waits for the fee.
  await db.promotionFeeRequest.create({
    data: {
      id: requestId,
      schoolId: s.schoolId,
      studentId: s.student.id,
      disciplineId: s.disciplineId,
      toRungId: s.rung['White 2'].id,
      toRungName: 'White 2',
      expectedCurrentRungId: s.rung['White 1'].id,
      amountMinor: 1800,
      currency: 'GBP',
      status: 'ACCEPTED',
      acceptedAt: new Date(),
      respondedById: s.student.id,
      promotionWaits: true,
      gradedById: s.ownerId,
      pendingGrade: {
        type: 'STRIPE_AWARD',
        targetRungId: s.rung['White 2'].id,
        expectedCurrentRungId: s.rung['White 1'].id,
        effectiveDate: today,
        note: null,
        acknowledgeWithoutSkillSignoff: true,
      },
    },
  });
  chargeId = randomUUID();
  await db.charge.create({
    data: {
      id: chargeId,
      schoolId: s.schoolId,
      studentId: s.student.id,
      invoiceNumber: 1,
      description: 'White 2',
      unitAmount: 1800,
      discountAmount: 0,
      taxRateBasisPoints: 0,
      taxInclusive: true,
      netAmount: 1800,
      taxAmount: 0,
      grossAmount: 1800,
      currency: 'GBP',
      dueDate: new Date(`${today}T00:00:00.000Z`),
      promotionFeeRequestId: requestId,
    },
  });
  await db.balanceEntry.create({ data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, kind: 'CHARGE', amount: 1800, currency: 'GBP', chargeId } });
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.chargeAllocation.deleteMany({ where });
  await db.balanceEntry.deleteMany({ where });
  await db.charge.deleteMany({ where });
  await db.promotionFeeRequest.deleteMany({ where });
  await db.paymentAccount.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

test('the Payments card labels the charge a promotion fee, links it to grading, and offers no Cancel', async ({ page }) => {
  await page.goto(`/students/${s.student.id}`);
  const card = page.getByTestId('student-charges');
  await expect(card.getByText('Owes 18.00 GBP')).toBeVisible();
  const row = page.getByRole('row', { name: /^#0000001 Promotion fee/ });
  await expect(row).toContainText('Promotion fee');
  await expect(row).toContainText('BJJ · White 2');
  await expect(row.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await expect(row).toContainText('Waive or cancel it in grading');
  await expect(row.getByTestId('promotion-fee-grading-link')).toHaveAttribute('href', `#grading-${s.disciplineId}`);

  const fees = page.getByTestId('promotion-fee-list');
  await expect(fees).toContainText('White 2');
  await expect(fees).toContainText('Accepted');
  await expect(fees).toContainText('Invoice #0000001: 18.00 GBP still to pay');
});

test('a desk payment in full shows the fee Paid in grading', async ({ page }) => {
  await page.goto(`/students/${s.student.id}`);
  const row = page.getByRole('row', { name: /^#0000001 Promotion fee/ });
  await row.getByRole('button', { name: 'Pay' }).click();
  const pay = page.getByTestId('record-charge-payment-form');
  await expect(pay.getByLabel('Amount received')).toHaveValue('18');
  await pay.getByRole('button', { name: 'Record payment' }).click();
  await expect(pay).toHaveCount(0);
  await expect(row).toContainText('Paid');
  const fees = page.getByTestId('promotion-fee-list');
  await expect(fees).toContainText('Paid');
  await expect(fees).toContainText('Invoice #0000001 paid');
  expect((await db.promotionFeeRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('PAID');
});

test("paid after the student's rank changed: shown as Paid — promotion can't apply; Grade stays available, and Cancel fee gives the money back as credit", async ({
  page,
}) => {
  // The rank changed after the grade (here: corrected straight to White 2), so the paid fee's promotion can't apply (Decision 414 item 1).
  await db.studentRank.update({
    where: { studentId_disciplineId: { studentId: s.student.id, disciplineId: s.disciplineId } },
    data: { currentRankId: s.rung['White 2'].rankId, currentStripeId: s.rung['White 2'].id },
  });
  await page.goto(`/students/${s.student.id}`);
  const row = page.getByRole('row', { name: /^#0000001 Promotion fee/ });
  await row.getByRole('button', { name: 'Pay' }).click();
  const pay = page.getByTestId('record-charge-payment-form');
  await pay.getByRole('button', { name: 'Record payment' }).click();
  await expect(pay).toHaveCount(0);
  await expect(row).toContainText('Paid');
  const request = await db.promotionFeeRequest.findUniqueOrThrow({ where: { id: requestId } });
  expect(request.status).toBe('ACCEPTED');
  expect(request.promotionBlockedAt).not.toBeNull();

  await page.reload();
  const box = page.getByRole('region', { name: 'Promotion fee', exact: true });
  await expect(box).toContainText("Paid — promotion can't apply");
  await expect(box).toContainText('the promotion can\'t apply: their rank or the belt ladder changed since the grade');
  await expect(box.getByRole('button', { name: 'Waive fee' })).toHaveCount(0);
  // Grading again is not held up.
  const style = page.getByRole('region', { name: 'BJJ', exact: true });
  await expect(style.getByRole('button', { name: 'Grade', exact: true })).toBeVisible();

  await box.getByRole('button', { name: 'Cancel fee' }).click();
  await expect(page.getByRole('region', { name: 'Promotion fee', exact: true })).toHaveCount(0);
  // Nothing is left "to decide": no Promote window opens.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row).toContainText('Cancelled');
  const charge = await db.charge.findUniqueOrThrow({ where: { id: chargeId } });
  expect(charge.cancelledAt).not.toBeNull();
  const after = await db.promotionFeeRequest.findUniqueOrThrow({ where: { id: requestId } });
  expect(after.status).toBe('CANCELLED');
  expect(after.toDecideAt).toBeNull();
});

test('waiving the fee in grading cancels its charge', async ({ page }) => {
  await page.goto(`/students/${s.student.id}`);
  const box = page.getByRole('region', { name: 'Promotion fee', exact: true });
  await box.getByRole('button', { name: 'Waive fee' }).click();
  const row = page.getByRole('row', { name: /^#0000001 Promotion fee/ });
  await expect(row).toContainText('Cancelled');
  await expect(row).toContainText('Fee waived in grading on');
  await expect(page.getByTestId('student-charges').getByText('Nothing owed')).toBeVisible();
  const charge = await db.charge.findUniqueOrThrow({ where: { id: chargeId } });
  expect(charge.cancelledAt).not.toBeNull();
  expect((await db.promotionFeeRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe('WAIVED');
});
