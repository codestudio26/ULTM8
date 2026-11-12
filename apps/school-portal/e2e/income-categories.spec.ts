import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';
import { pickOption } from './team-helpers';

/**
 * Income categories (Decision 316 item 10), the owner's side: the School
 * page's "Income categories" card (add, rename, delete one nothing uses), the
 * plan form's picker, and the picker on a new charge, whose category then shows
 * on the student's Payments card. The Transactions CSV column is covered in
 * transactions.spec.ts, the API rules in apps/api/test/income-categories.e2e-spec.ts.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await db.school.update({ where: { id: s.schoolId }, data: { defaultCurrency: 'GBP' } });
  await db.paymentAccount.create({ data: { id: randomUUID(), schoolId: s.schoolId, provider: 'CASH', accountTitle: 'Desk', country: 'GB' } });
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.chargeAllocation.deleteMany({ where });
  await db.balanceEntry.deleteMany({ where });
  await db.charge.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
  await db.incomeCategory.deleteMany({ where });
  await db.paymentAccount.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

test('the owner adds, renames and deletes categories on the School page', async ({ page }) => {
  await page.goto('/school');
  const card = page.locator('.ultm8-card').filter({ has: page.getByRole('heading', { name: 'Income categories' }) });
  await expect(card.getByText('No income categories yet.')).toBeVisible();

  await card.getByLabel('New income category').fill('Merch');
  await card.getByRole('button', { name: 'Add category' }).click();
  await expect(card.getByLabel('Name of Merch')).toBeVisible();
  await card.getByLabel('New income category').fill('Kids programme');
  await card.getByRole('button', { name: 'Add category' }).click();
  await expect(card.getByLabel('Name of Kids programme')).toBeVisible();

  await card.getByLabel('Name of Merch').fill('Merchandise');
  await card.getByRole('listitem').filter({ has: page.getByLabel('Name of Merch') }).getByRole('button', { name: 'Rename' }).click();
  await expect(card.getByLabel('Name of Merchandise')).toBeVisible();

  const kidsRow = card.getByRole('listitem').filter({ has: page.getByLabel('Name of Kids programme') });
  await kidsRow.getByRole('button', { name: 'Delete' }).click();
  await kidsRow.getByRole('button', { name: 'Delete' }).click();
  await expect(card.getByLabel('Name of Kids programme')).toHaveCount(0);
  expect((await db.incomeCategory.findMany({ where: { schoolId: s.schoolId } })).map((c) => c.name)).toEqual(['Merchandise']);
});

test('a plan and a charge take a category; one in use has no Delete button', async ({ page }) => {
  const category = await db.incomeCategory.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'Kids programme' } });

  await page.goto('/membership-plans');
  await page.getByRole('button', { name: 'Add plan' }).click();
  await page.getByLabel('Title').fill('Kids monthly');
  await page.getByRole('button', { name: '2. Pricing & Access' }).click();
  await page.getByLabel('Price').fill('40');
  await page.getByRole('button', { name: '3. Policies' }).click();
  await pickOption(page, 'Income category', 'Kids programme');
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'Kids monthly', exact: true })).toBeVisible();
  const plan = await db.membershipPlan.findFirstOrThrow({ where: { schoolId: s.schoolId, title: 'Kids monthly' } });
  expect(plan.incomeCategoryId).toBe(category.id);

  await page.goto(`/students/${s.student.id}`);
  const card = page.getByTestId('student-charges');
  await card.getByRole('button', { name: '+ Create charge' }).click();
  const create = page.getByTestId('create-charge-form');
  await create.getByLabel('Description').fill('Kids T-shirt');
  await create.getByLabel('Price').fill('15');
  await pickOption(create, 'Income category', 'Kids programme');
  await create.getByRole('button', { name: 'Create charge' }).click();
  await expect(create).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Kids T-shirt/ })).toContainText('Income category: Kids programme');
  expect((await db.charge.findFirstOrThrow({ where: { schoolId: s.schoolId, description: 'Kids T-shirt' } })).incomeCategoryId).toBe(category.id);

  await page.goto('/school');
  const settings = page.locator('.ultm8-card').filter({ has: page.getByRole('heading', { name: 'Income categories' }) });
  await expect(settings.getByText('Plans and charges using it: 2')).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Delete' })).toHaveCount(0);
});
