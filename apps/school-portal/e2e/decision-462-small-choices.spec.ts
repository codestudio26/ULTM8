import { randomUUID } from 'crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';
import { pickOption } from './team-helpers';

/**
 * Decision 462's small choices, items 24, 28, 29, 30 and 32:
 * 24. Show QR and Roll call have a "‹ Classes" link at the top.
 * 28. Billing → Transactions pop-ups say "Cancel" instead of "Back".
 * 29. The Membership plan form names each step once: the step's pill, not
 *     also a title over the step's fields.
 * 30. The Membership plan form has a "‹ Membership Plans" link at the top
 *     instead of the "← Back to Membership Plans" button.
 * 32. Team → Staff → Give a role: the role is chosen with round buttons
 *     (pills), the same three roles as before.
 * Everything else on these pages behaves as before (their own specs).
 */
let s: GradingSchool;
const HOUR = 3_600_000;

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.booking.deleteMany({ where });
  await db.deskSaleRefund.deleteMany({ where });
  await db.transaction.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
  await db.paymentAccount.deleteMany({ where });
  await db.class.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

/** The page header's "‹ Parent" link. */
const parentLink = (page: Page) => page.locator('.u8n-page-header a.u8n-page-header__parent');

test('24: Show QR and Roll call have a "‹ Classes" link that goes back to Classes', async ({ page }) => {
  const cls = await db.class.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      title: 'Evening BJJ',
      activities: ['BJJ'],
      styles: [{ disciplineId: s.disciplineId, classType: null }],
      startDate: new Date(Date.now() - 10 * 60_000),
      endDate: new Date(Date.now() + HOUR),
    },
  });
  await signIn(page, s.ownerToken);

  for (const [path, title] of [
    ['qr-code', 'QR check-in — Evening BJJ'],
    ['roll-call', 'Roll call — Evening BJJ'],
  ]) {
    await page.goto(`/classes/${cls.id}/${path}`);
    await expect(page.locator('.u8n-page-header').getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(parentLink(page)).toHaveText('‹ Classes');
    await parentLink(page).click();
    await expect(page).toHaveURL(/\/classes$/);
  }
});

test('28: every Transactions pop-up says Cancel, not Back, and Cancel changes nothing', async ({ page }) => {
  await db.school.update({ where: { id: s.schoolId }, data: { defaultCurrency: 'GBP' } });
  const account = await db.paymentAccount.create({ data: { id: randomUUID(), schoolId: s.schoolId, provider: 'STRIPE', accountTitle: 'Desk', country: 'GB' } });
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: '10-Class Pack', price: 15000, classesIncluded: 10, currency: 'GBP' },
  });
  const pay = (status: 'PENDING' | 'SUCCESSFUL', daysAgo: number) =>
    db.transaction.create({
      data: {
        id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, paymentAccountId: account.id, membershipPlanId: plan.id,
        kind: 'MEMBERSHIP', amount: 15000, currency: 'GBP', status, paymentMethod: 'CASH', billingDate: new Date(Date.now() - daysAgo * 86_400_000),
      },
    });
  const pending = await pay('PENDING', 2);
  const paid = await pay('SUCCESSFUL', 3);
  await signIn(page, s.ownerToken);
  await page.goto('/transactions');
  const dialog = page.getByRole('dialog');
  const band = (d: Locator) => d.locator('.ultm8-modal__actions').getByRole('button');
  const pendingRow = page.locator('tbody tr').filter({ has: page.getByRole('button', { name: 'Mark as paid' }) });

  const opens: Array<[() => Promise<void>, string]> = [
    [() => pendingRow.getByRole('button', { name: 'Mark as paid' }).click(), 'Mark as paid'],
    [() => pendingRow.getByRole('button', { name: 'Cancel payment' }).click(), 'Cancel payment'],
    [() => page.locator('tbody tr').getByRole('button', { name: 'Refund', exact: true }).click(), 'Record refund'],
    [() => page.getByRole('button', { name: 'Record a payment' }).click(), 'Record payment'],
  ];
  for (const [open, action] of opens) {
    await open();
    await expect(band(dialog)).toHaveText(['Cancel', action]);
    await expect(dialog.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  // Nothing was paid, cancelled, refunded or recorded.
  expect((await db.transaction.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('PENDING');
  expect((await db.transaction.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe('SUCCESSFUL');
  expect(await db.transaction.count({ where: { schoolId: s.schoolId } })).toBe(2);
  expect(await db.deskSaleRefund.count({ where: { schoolId: s.schoolId } })).toBe(0);
});

test('29: the plan form names each step once, on its pill, not also over its fields', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/membership-plans/new');
  await expect(page.locator('.u8n-page-header').getByRole('heading', { level: 1, name: 'Add membership plan' })).toBeVisible();

  // Each step's name shows once, on its pill; the step's fields carry no
  // title or number of their own (the group is still named, for screen readers).
  const sheet = page.locator('form.u8f-sheet').first();
  const steps = ['Basics', 'Pricing & Access', 'Policies', 'Disciplines & Lessons', 'Visibility'];
  for (const [i, name] of steps.entries()) {
    await page.getByRole('button', { name: `${i + 1}. ${name}` }).click();
    await expect(page.getByRole('button', { name: `${i + 1}. ${name}` })).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByRole('group', { name, exact: true })).toBeVisible();
    await expect(sheet.locator('h2, .ultm8-chapter__number')).toHaveCount(0);
    await expect(page.locator('.u8n-content').getByText(name, { exact: true })).toHaveCount(0);
  }
});

test('30: the plan form has a "‹ Membership Plans" link instead of the Back button', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/membership-plans/new');
  await expect(page.locator('.u8n-page-header').getByRole('heading', { level: 1, name: 'Add membership plan' })).toBeVisible();
  await expect(parentLink(page)).toHaveText('‹ Membership Plans');
  await expect(page.getByRole('button', { name: /Back to Membership Plans/ })).toHaveCount(0);

  // The link goes back to the list, as the button did.
  await parentLink(page).click();
  await expect(page).toHaveURL(/\/membership-plans$/);

  // The same on Edit.
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: 'Monthly', price: 5000, currency: 'GBP' } });
  await page.goto(`/membership-plans/${plan.id}/edit`);
  await expect(page.locator('.u8n-page-header').getByRole('heading', { level: 1, name: 'Edit membership plan' })).toBeVisible();
  await expect(parentLink(page)).toHaveText('‹ Membership Plans');
  await expect(page.getByRole('button', { name: /Back to Membership Plans/ })).toHaveCount(0);
});

test('32: Give a role picks the role with round buttons, the same three roles, and gives it', async ({ page }) => {
  await addBranch(s, 'North');
  const tara = await addPerson('Tara', 'Target');
  await signIn(page, s.ownerToken);
  await page.goto('/staff');
  const card = page.locator('.u8t-card', { has: page.getByRole('heading', { name: 'Give a role' }) });
  await card.getByLabel('Email').fill(tara.email);
  await card.getByRole('button', { name: 'Find' }).click();
  await expect(page.getByText('Found Tara Target.')).toBeVisible();

  // Pills, not a drop-down: Instructor is picked to start with, as before.
  await expect(card.getByRole('combobox', { name: 'Role' })).toHaveCount(0);
  const roles = card.getByRole('group', { name: 'Role' });
  await expect(roles).toHaveClass(/ultm8-pills/);
  await expect(roles.getByRole('button')).toHaveText(['Instructor', 'Branch Staff', 'Co-owner']);
  await expect(roles.getByRole('button', { name: 'Instructor' })).toHaveAttribute('aria-pressed', 'true');

  // Picking Co-owner shows its note and hides the branch, as the drop-down did.
  await roles.getByRole('button', { name: 'Co-owner' }).click();
  await expect(roles.getByRole('button', { name: 'Co-owner' })).toHaveAttribute('aria-pressed', 'true');
  await expect(roles.getByRole('button', { name: 'Instructor' })).toHaveAttribute('aria-pressed', 'false');
  await expect(card.getByText(/A co-owner runs the School with you/)).toBeVisible();
  await expect(card.getByRole('combobox', { name: 'Branch' })).toHaveCount(0);

  // Branch Staff: the branch is asked for, and the role is given.
  await roles.getByRole('button', { name: 'Branch Staff' }).click();
  await expect(card.getByText(/A co-owner runs the School with you/)).toHaveCount(0);
  await pickOption(card, 'Branch', 'North');
  await card.getByRole('button', { name: 'Give role' }).click();
  await expect(page.getByText(/^Tara Target is now Branch Staff/)).toBeVisible();
  expect(await db.roleGrant.count({ where: { userId: tara.id, schoolId: s.schoolId, role: 'BRANCH_STAFF', revokedAt: null } })).toBe(1);
});
