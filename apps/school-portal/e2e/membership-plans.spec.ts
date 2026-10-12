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
  await expect(page.getByRole('cell', { name: 'Monthly Unlimited', exact: true })).toBeVisible();

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

  await expect(page.getByRole('cell', { name: 'Monthly Unlimited (Updated)', exact: true })).toBeVisible();
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

  await expect(page.getByRole('cell', { name: 'Open Mat Pack', exact: true })).toBeVisible();
  const created = await db.membershipPlan.findFirstOrThrow({ where: { schoolId: s.schoolId, title: 'Open Mat Pack' } });
  planIds.push(created.id);
  expect(created.classesIncluded).toBe(1);
  expect(created.scopedClassId).toBe(classId);

  // Duplicate now lives in the row's own action menu (RowActionsMenu,
  // alongside Archive) rather than a standalone row button.
  await page.getByRole('row', { name: /Open Mat Pack/ }).getByRole('button', { name: /Actions for Open Mat Pack/ }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.getByRole('heading', { name: 'Add membership plan' })).toBeVisible();
  // Duplicate prefills from the source plan — step 1 (Basics) shows the
  // copied title immediately; step 2 needs a click to see its copied fields.
  await expect(page.getByLabel('Title')).toHaveValue('Open Mat Pack (copy)');
  await page.getByRole('button', { name: '2. Pricing & Access' }).click();
  await expect(page.getByLabel(/Classes included/)).toHaveValue('1');
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('cell', { name: 'Open Mat Pack (copy)', exact: true })).toBeVisible();
  const duplicate = await db.membershipPlan.findFirstOrThrow({ where: { schoolId: s.schoolId, title: 'Open Mat Pack (copy)' } });
  planIds.push(duplicate.id);
  expect(duplicate.classesIncluded).toBe(1);
  expect(duplicate.scopedClassId).toBe(classId);
});

// ---------------------------------------------------------------------------
// v1.2 backend backlog — the "Active members" stat tile is real now (summed
// across every plan's own GET /membership-plans/{id}/active-count), not the
// "—" placeholder.
// ---------------------------------------------------------------------------

test('the Active members stat tile reflects real, live Memberships across every plan', async ({ page }) => {
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: 'Active Tile Pack', price: 1000, classesIncluded: 5 },
  });
  planIds.push(plan.id);
  const live = await db.membership.create({
    data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: plan.id, schoolId: s.schoolId, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining: 3 },
  });
  // Used up — must not count.
  const usedUp = await db.membership.create({
    data: { id: randomUUID(), studentId: s.newStudent.id, membershipPlanId: plan.id, schoolId: s.schoolId, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining: 0 },
  });

  try {
    await page.goto('/membership-plans');
    await expect(page.getByRole('cell', { name: 'Active Tile Pack', exact: true })).toBeVisible();
    const tile = page.locator('span', { hasText: 'Active members' }).locator('..');
    await expect(tile.getByText('1', { exact: true })).toBeVisible();
  } finally {
    await db.membership.deleteMany({ where: { id: { in: [live.id, usedUp.id] } } });
  }
});

// ---------------------------------------------------------------------------
// v1.2 backend backlog — Archive lifecycle state. A real new MembershipPlan
// lifecycle state (`archivedAt`), distinct from `visible` — the row's own
// action menu (RowActionsMenu) gains Archive/Unarchive, and the stats ribbon
// gains a 4th Archived tile.
// ---------------------------------------------------------------------------

test('Archive moves a plan out of Visible/Hidden into its own Archived tile, disables its Visibility toggle, and Unarchive reverses it', async ({ page }) => {
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: 'Archive Me', price: 1500, classesIncluded: 5, visible: true },
  });
  planIds.push(plan.id);

  await page.goto('/membership-plans');
  await expect(page.getByRole('cell', { name: 'Archive Me', exact: true })).toBeVisible();

  // `data-testid="stat-tile-<label>"` — plain label text isn't unique on
  // this page by itself once a plan is archived (the row's own "Archived"
  // Badge is also a <span> with that exact text).
  function tileValue(label: string) {
    return page.getByTestId(`stat-tile-${label}`).locator('span').nth(1);
  }
  const totalBefore = await tileValue('Total plans').textContent();
  const visibleBefore = Number(await tileValue('Visible').textContent());
  const archivedBefore = Number(await tileValue('Archived').textContent());

  const row = page.getByRole('row', { name: /Archive Me/ });
  await row.getByRole('button', { name: 'Actions for Archive Me' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();

  // Total is unchanged (archiving never removes the row); Archived gains
  // exactly one, Visible loses exactly one — Visible/Hidden scope to
  // non-archived plans only (see MembershipPlansPage.tsx's own comment).
  await expect(page.getByRole('row', { name: /Archive Me/ }).getByText('Archived', { exact: true })).toBeVisible();
  await expect(tileValue('Total plans')).toHaveText(totalBefore!);
  await expect(tileValue('Archived')).toHaveText(String(archivedBefore + 1));
  await expect(tileValue('Visible')).toHaveText(String(visibleBefore - 1));

  // Visibility toggle is disabled (moot) once archived.
  await expect(row.getByRole('checkbox', { name: 'Visible' })).toBeDisabled();

  const archived = await db.membershipPlan.findUniqueOrThrow({ where: { id: plan.id } });
  expect(archived.archivedAt).not.toBeNull();

  // Unarchive reverses it — the action menu now offers Unarchive instead.
  await row.getByRole('button', { name: 'Actions for Archive Me' }).click();
  await page.getByRole('menuitem', { name: 'Unarchive' }).click();
  await expect(row.getByText('Archived', { exact: true })).toHaveCount(0);
  await expect(tileValue('Archived')).toHaveText(String(archivedBefore));
  await expect(row.getByRole('checkbox', { name: 'Visible' })).toBeEnabled();

  const unarchived = await db.membershipPlan.findUniqueOrThrow({ where: { id: plan.id } });
  expect(unarchived.archivedAt).toBeNull();
});

// ---------------------------------------------------------------------------
// v1.2 backend backlog — Subscription price-change migrate-vs-grandfather
// prompt. This fixture School has no PaymentAccount at all, so a choice that
// reaches the server resolves to a clean, already-existing 400 ("no
// fully-onboarded Stripe PaymentAccount") rather than ever making a live
// Stripe network call — the same constraint every Stripe-touching e2e-spec
// in apps/api/test already documents (CI's STRIPE_SECRET_KEY is a dummy
// value). What's proven here is the REQUIRED-CHOICE UI flow itself: the
// prompt only appears when it's actually relevant, and Save stays blocked
// client-side until a choice is made — not the Stripe outcome itself, which
// apps/api/test/membership-plan-archive-and-price-change.e2e-spec.ts proves
// with a faked Stripe client instead.
// ---------------------------------------------------------------------------

test('editing a SUBSCRIPTION plan price with an active subscriber shows the required Migrate/Grandfather prompt and blocks Save until one is chosen', async ({ page }) => {
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: 'Live Subscription', price: 5000, currency: 'gbp' },
  });
  planIds.push(plan.id);
  const membership = await db.membership.create({
    data: {
      id: randomUUID(),
      studentId: s.student.id,
      membershipPlanId: plan.id,
      schoolId: s.schoolId,
      status: 'ACTIVE',
      frequency: 'RECURRING',
      stripeSubscriptionId: `sub_fixture_${randomUUID()}`,
    },
  });

  try {
    await page.goto('/membership-plans');
    await page.getByRole('row', { name: /Live Subscription/ }).getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit membership plan' })).toBeVisible();
    await page.getByRole('button', { name: '2. Pricing & Access' }).click();

    // No prompt yet — the price hasn't changed.
    await expect(page.getByText('This price change affects existing subscribers')).toHaveCount(0);

    await page.getByLabel('Price').fill('6000');
    await expect(page.getByText('This price change affects existing subscribers')).toBeVisible();
    await expect(page.getByText('1 active subscriber currently billing at the old price.')).toBeVisible();

    await page.getByRole('button', { name: '5. Visibility' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    // Blocked client-side — no choice was made yet.
    await expect(page.getByText(/choose Migrate or Grandfather before saving/)).toBeVisible();
    await expect(page).toHaveURL(/\/membership-plans\/.+\/edit$/);

    await page.getByRole('button', { name: '2. Pricing & Access' }).click();
    await page.getByRole('button', { name: 'Grandfather existing subscribers' }).click();
    await expect(page.getByText(/Existing subscribers keep billing at their original price indefinitely/)).toBeVisible();
    await page.getByRole('button', { name: '5. Visibility' }).click();
    await page.getByRole('button', { name: 'Save' }).click();

    // The choice itself is now accepted client-side — the request reaches
    // the server, which cleanly rejects it for an unrelated, pre-existing
    // reason (no PaymentAccount configured for this fixture School at all),
    // never a live Stripe call. Confirms the form actually sent
    // priceChangeStrategy rather than silently dropping it.
    await expect(page.getByText(/PaymentAccount/)).toBeVisible();

    const unchanged = await db.membershipPlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(unchanged.price).toBe(5000);
  } finally {
    await db.membership.delete({ where: { id: membership.id } });
  }
});
