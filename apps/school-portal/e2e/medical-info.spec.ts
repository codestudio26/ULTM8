import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Medical information at sign-up (Decision 315 item 10): the owner turns the
 * School setting on (off by default); the student's page shows what was given
 * and who consented, to the owner and to Branch Staff only once the owner
 * turns on "See medical information" in their Access.
 *
 * Seed: Sam Lee, enrolled, with medical information he consented to himself.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool();
  await db.studentMedicalInfo.create({
    data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, body: 'Asthma: inhaler in the kit bag.', consentedById: s.student.id, consentedAt: new Date() },
  });
});

test.afterAll(async () => {
  await db.studentMedicalInfo.deleteMany({});
  await cleanup();
});

test('the owner turns medical information on for the School', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/school');
  const card = page.locator('#medical-info');
  await expect(card.getByText('Medical information at sign-up')).toBeVisible();
  await expect(card.getByLabel('Ask for medical information')).not.toBeChecked();
  await card.getByLabel('Ask for medical information').check();
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByText('Saved.')).toBeVisible();
  expect((await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).medicalInfoEnabled).toBe(true);
});

test("the owner sees a student's medical information; Branch Staff only after the owner allows it", async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto(`/students/${s.student.id}`);
  await expect(page.getByTestId('student-medical-info')).toHaveText('Asthma: inhaler in the kit bag.');
  await expect(page.getByText(/Given with consent by Sam Lee on/)).toBeVisible();

  const north = await addBranch(s, 'North');
  const bea = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, branchId: north.id } });

  await signIn(page, bea.token);
  await page.goto(`/students/${s.student.id}`);
  await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
  await expect(page.getByText('Medical information')).toHaveCount(0);

  await signIn(page, s.ownerToken);
  await page.goto('/staff');
  const row = page.locator('.ultm8-card').filter({ hasText: 'Your staff' }).getByRole('row').filter({ hasText: 'Bea Desk' });
  await row.getByRole('button', { name: 'Actions for Bea Desk' }).click();
  await page.getByRole('menuitem', { name: 'Access' }).click();
  const dialog = page.getByRole('dialog', { name: 'Access for Bea Desk' });
  await expect(dialog.getByLabel('See medical information')).not.toBeChecked();
  await dialog.getByLabel('See medical information').check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Access saved for Bea Desk.')).toBeVisible();
  expect((await db.staffPermission.findFirstOrThrow({ where: { userId: bea.id } })).canSeeMedicalInfo).toBe(true);

  await signIn(page, bea.token);
  await page.goto(`/students/${s.student.id}`);
  await expect(page.getByTestId('student-medical-info')).toHaveText('Asthma: inhaler in the kit bag.');
});
