import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 392 — sign-up on the front-desk tablet (handover F5): someone signs
 * up on the tablet, the owner sees it under Students → Sign-ups and approves
 * or rejects it; and the School's own "How did you hear about us?" list.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  const made = await db.signUp.findMany({ where: { ...where, userId: { not: null } }, select: { userId: true } });
  await db.signUp.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
  await db.frontDeskSession.deleteMany({ where });
  await db.staffKioskCode.deleteMany({ where });
  await db.roleGrant.deleteMany({ where: { userId: { in: made.map((m) => m.userId as string) } } });
  await db.user.deleteMany({ where: { id: { in: made.map((m) => m.userId as string) } } });
});

test.afterAll(async () => {
  await cleanup();
});

async function openTablet(page: Page) {
  await signIn(page, s.ownerToken);
  await page.goto('/front-desk');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page).toHaveURL(/\/front-desk\/kiosk$/);
}

async function fillSignUp(page: Page, email: string, opts: { visitor?: boolean } = {}) {
  await page.getByRole('button', { name: /Sign up/ }).click();
  if (opts.visitor) await page.getByRole('radio', { name: 'Visitor' }).click();
  await page.getByLabel('First name *').fill('Tess');
  await page.getByLabel('Last name *').fill('Tablet');
  await page.getByLabel('Date of birth *').fill('1994-06-15');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Email *').fill(email);
  await page.getByLabel('How did you hear about us?').selectOption('Walked past');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Name').first().fill('Ray Tablet');
  await page.getByRole('button', { name: /Send sign-up/ }).click();
  await expect(page.getByText('Thanks')).toBeVisible();
}

test('a sign-up on the tablet waits for staff, who approve it: the person becomes a student', async ({ page }) => {
  const email = `tablet-${randomUUID()}@example.test`;
  await openTablet(page);
  // No visit pass length set: the tablet offers Member only.
  await page.getByRole('button', { name: /Sign up/ }).click();
  await expect(page.getByRole('radio', { name: 'Visitor' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to check-in' }).click();
  await fillSignUp(page, email);
  const row = await db.signUp.findFirstOrThrow({ where: { schoolId: s.schoolId, email } });
  expect(row).toMatchObject({ status: 'PENDING', heardFrom: 'Walked past', kind: 'MEMBER' });

  // Staff side (a fresh sign-in; the tablet signed the owner out of this browser).
  await signIn(page, s.ownerToken);
  await page.goto('/students/sign-ups');
  await expect(page.getByRole('link', { name: 'Sign-ups (1)' })).toBeVisible();
  const card = page.getByTestId('sign-up').filter({ hasText: 'Tess Tablet' });
  await expect(card).toContainText('Walked past');
  await expect(card).toContainText('Waiting for staff');
  await card.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/Tess Tablet is now a student/)).toBeVisible();
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  expect(await db.roleGrant.count({ where: { userId: user.id, schoolId: s.schoolId, role: 'STUDENT' } })).toBe(1);

  await page.getByRole('tab', { name: 'Done' }).click();
  await expect(page.getByTestId('sign-up').filter({ hasText: 'Tess Tablet' })).toContainText('Approved by Olive');
});

test('staff reject a sign-up: it moves to Rejected, where it can still be approved', async ({ page }) => {
  await db.school.update({ where: { id: s.schoolId }, data: { visitorPeriodDays: 7 } });
  const email = `tablet-${randomUUID()}@example.test`;
  await openTablet(page);
  await fillSignUp(page, email, { visitor: true });

  await signIn(page, s.ownerToken);
  await page.goto('/students/sign-ups');
  const card = page.getByTestId('sign-up').filter({ hasText: 'Tess Tablet' });
  await expect(card).toContainText('Visitor');
  await card.getByRole('button', { name: 'Reject' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByTestId('sign-up').filter({ hasText: 'Tess Tablet' })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Rejected' }).click();
  const rejected = page.getByTestId('sign-up').filter({ hasText: 'Tess Tablet' });
  await expect(rejected).toContainText(/Rejected by Olive Owner\. You can still approve it until/);
  await rejected.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('dialog')).toContainText('They signed up as a Visitor, so they also get a visit pass.');
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/They have a visit pass\./)).toBeVisible();
});

test('the School edits its "How did you hear about us?" list, and the tablet shows it', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/school');
  const card = page.locator('#heard-from');
  await expect(card.getByLabel('Choice 1')).toHaveValue('Friend');
  await card.getByLabel('Choice 4').fill('Flyer');
  await card.getByRole('button', { name: 'Add a choice' }).click();
  await card.getByLabel('Choice 5').fill('flyer');
  await expect(card.getByText('Each choice can appear only once.')).toBeVisible();
  await card.getByLabel('Choice 5').fill('Radio');
  await card.getByRole('button', { name: 'Save changes' }).click();
  await expect(card.getByText('Saved.')).toBeVisible();
  const school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(school.heardFromOptions).toEqual(['Friend', 'Instagram', 'Google', 'Flyer', 'Radio']);

  await page.goto('/front-desk');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: /Sign up/ }).click();
  await page.getByLabel('First name *').fill('Tess');
  await page.getByLabel('Last name *').fill('Tablet');
  await page.getByLabel('Date of birth *').fill('1994-06-15');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByLabel('How did you hear about us?').locator('option')).toHaveText(['', 'Friend', 'Instagram', 'Google', 'Flyer', 'Radio']);
});
