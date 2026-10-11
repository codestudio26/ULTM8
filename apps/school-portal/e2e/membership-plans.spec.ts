import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Create/Update Membership Plan, rebuilt as a dedicated full page (first of
 * its kind in this app — every other entity still uses a List + Modal,
 * Decision 209), then as a multi-step wizard (Decision 209 follow-up): the
 * page's 5 sections (Basics / Pricing & Access / Policies / Disciplines &
 * Lessons / Visibility) each become one step, shown one at a time, with a
 * clickable pill row that can jump to any step directly (not strictly
 * linear — Edit especially shouldn't require clicking Next four times to
 * reach one field).
 *
 * Covers the type-conditional field visibility (classesIncluded/
 * scopedClassId only for Class Pack/Friend Pass, which only matters once
 * their step — "2. Pricing & Access" — is actually shown) and the
 * client-side Duplicate flow (prefills the Add page via router state, no
 * backend endpoint).
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

test('add a Subscription plan across steps (classesIncluded/scopedClass stay hidden), then edit it', async ({ page }) => {
  await page.goto('/membership-plans');
  await page.getByRole('button', { name: 'Add plan' }).click();
  await expect(page.getByRole('heading', { name: 'Add membership plan' })).toBeVisible();

  // Step 1: Basics.
  await expect(page.getByRole('button', { name: '1. Basics' })).toBeVisible();
  await page.getByLabel('Title').fill('Monthly Unlimited');
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 2: Pricing & Access — Subscription is the default type, so Class
  // Pack/Friend Pass-only fields stay hidden even on their own step.
  await expect(page.getByLabel('Price')).toBeVisible();
  await expect(page.getByLabel('Classes included')).toHaveCount(0);
  await expect(page.getByLabel('Scoped to Class')).toHaveCount(0);
  await page.getByLabel('Price').fill('5000');

  // Jump straight to the last step via its pill, skipping Policies/Disciplines.
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await expect(page.getByLabel('Visible to Students')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(/\/membership-plans$/);
  await expect(page.getByRole('cell', { name: 'Monthly Unlimited' })).toBeVisible();

  const created = await db.membershipPlan.findFirstOrThrow({ where: { schoolId: s.schoolId, title: 'Monthly Unlimited' } });
  planIds.push(created.id);
  expect(created.price).toBe(5000);

  await page.getByRole('row', { name: /Monthly Unlimited/ }).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit membership plan' })).toBeVisible();
  // Edit lands on step 1 too, but the Title field it needs is right there —
  // no step navigation required to make a small fix.
  await expect(page.getByLabel('Title')).toHaveValue('Monthly Unlimited');
  await page.getByLabel('Title').fill('Monthly Unlimited (Updated)');
  // Jump straight to the final step rather than clicking Next three times.
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('cell', { name: 'Monthly Unlimited (Updated)' })).toBeVisible();
});

test('add a Class Pack scoped to a Class, then duplicate it', async ({ page }) => {
  await page.goto('/membership-plans');
  await page.getByRole('button', { name: 'Add plan' }).click();
  await page.getByLabel('Type').selectOption('CLASS_PACK');
  await page.getByLabel('Title').fill('Open Mat Pack');
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 2: Pricing & Access — Class Pack fields now show. Scoping to a
  // Class locks Classes included to 1 immediately (a one-off Class has only
  // one occurrence; the server rejects anything higher) — asserted here too,
  // since this is exactly the bug the stress test found and fixed.
  await page.getByLabel('Price').fill('2000');
  await page.getByLabel('Scoped to Class').selectOption({ label: 'Open Mat' });
  await expect(page.getByLabel(/Classes included/)).toHaveValue('1');

  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('cell', { name: 'Open Mat Pack' })).toBeVisible();
  const created = await db.membershipPlan.findFirstOrThrow({ where: { schoolId: s.schoolId, title: 'Open Mat Pack' } });
  planIds.push(created.id);
  expect(created.classesIncluded).toBe(1);
  expect(created.scopedClassId).toBe(classId);

  await page.getByRole('row', { name: /Open Mat Pack/ }).getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.getByRole('heading', { name: 'Add membership plan' })).toBeVisible();
  // Duplicate prefills from the source plan — step 1 (Basics) shows the
  // copied title immediately; step 2 needs a click to see its copied fields.
  await expect(page.getByLabel('Title')).toHaveValue('Open Mat Pack (copy)');
  await page.getByRole('button', { name: '2. Pricing & Access' }).click();
  await expect(page.getByLabel(/Classes included/)).toHaveValue('1');
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('cell', { name: 'Open Mat Pack (copy)' })).toBeVisible();
  const duplicate = await db.membershipPlan.findFirstOrThrow({ where: { schoolId: s.schoolId, title: 'Open Mat Pack (copy)' } });
  planIds.push(duplicate.id);
  expect(duplicate.classesIncluded).toBe(1);
  expect(duplicate.scopedClassId).toBe(classId);
});
