import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Create/Update Membership Plan, rebuilt as a dedicated full page (first of
 * its kind in this app — every other entity still uses a List + Modal,
 * Decision 209). Covers the type-conditional field visibility (classesIncluded/
 * scopedClassId only for Class Pack/Friend Pass) and the client-side
 * Duplicate flow (prefills the Add page via router state, no backend
 * endpoint).
 */
let s: GradingSchool;
let classId: string;
const planIds: string[] = [];

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  const cls = await db.class.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      title: 'Open Mat',
      activities: ['BJJ'],
      startDate: new Date(),
      endDate: new Date(Date.now() + 3600_000),
    },
  });
  classId = cls.id;
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  await db.membershipPlan.deleteMany({ where: { id: { in: planIds } } });
  planIds.length = 0;
  await db.class.deleteMany({ where: { id: classId } });
});

test.afterAll(async () => {
  await cleanup();
});

test('add a Subscription plan (classesIncluded/scopedClass hidden), then edit it', async ({ page }) => {
  await page.goto('/membership-plans');
  await page.getByRole('button', { name: 'Add plan' }).click();
  await expect(page.getByRole('heading', { name: 'Add membership plan' })).toBeVisible();

  // Subscription is the default type — Class Pack/Friend Pass-only fields stay hidden.
  await expect(page.getByLabel('Classes included')).toHaveCount(0);
  await expect(page.getByLabel('Scoped to Class')).toHaveCount(0);

  await page.getByLabel('Title').fill('Monthly Unlimited');
  await page.getByLabel('Price').fill('5000');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(/\/membership-plans$/);
  await expect(page.getByRole('cell', { name: 'Monthly Unlimited' })).toBeVisible();

  const created = await db.membershipPlan.findFirstOrThrow({ where: { schoolId: s.schoolId, title: 'Monthly Unlimited' } });
  planIds.push(created.id);
  expect(created.price).toBe(5000);

  await page.getByRole('row', { name: /Monthly Unlimited/ }).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit membership plan' })).toBeVisible();
  await expect(page.getByLabel('Title')).toHaveValue('Monthly Unlimited');
  await page.getByLabel('Title').fill('Monthly Unlimited (Updated)');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('cell', { name: 'Monthly Unlimited (Updated)' })).toBeVisible();
});

test('add a Class Pack scoped to a Class, then duplicate it', async ({ page }) => {
  await page.goto('/membership-plans');
  await page.getByRole('button', { name: 'Add plan' }).click();
  await page.getByLabel('Type').selectOption('CLASS_PACK');
  await page.getByLabel('Title').fill('5-Class Pack');
  await page.getByLabel('Price').fill('2000');
  await page.getByLabel('Classes included').fill('5');
  await page.getByLabel('Scoped to Class').selectOption({ label: 'Open Mat' });
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('cell', { name: '5-Class Pack' })).toBeVisible();
  const created = await db.membershipPlan.findFirstOrThrow({ where: { schoolId: s.schoolId, title: '5-Class Pack' } });
  planIds.push(created.id);
  expect(created.classesIncluded).toBe(5);
  expect(created.scopedClassId).toBe(classId);

  await page.getByRole('row', { name: /5-Class Pack/ }).getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.getByRole('heading', { name: 'Add membership plan' })).toBeVisible();
  await expect(page.getByLabel('Title')).toHaveValue('5-Class Pack (copy)');
  await expect(page.getByLabel('Classes included')).toHaveValue('5');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('cell', { name: '5-Class Pack (copy)' })).toBeVisible();
  const duplicate = await db.membershipPlan.findFirstOrThrow({ where: { schoolId: s.schoolId, title: '5-Class Pack (copy)' } });
  planIds.push(duplicate.id);
  expect(duplicate.classesIncluded).toBe(5);
  expect(duplicate.scopedClassId).toBe(classId);
});
