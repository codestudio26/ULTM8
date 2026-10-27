import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

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
      // Tomorrow: a plan for a class that has already started is refused
      // (Decision 334, M15).
      startDate: new Date(Date.now() + 86_400_000),
      endDate: new Date(Date.now() + 86_400_000 + 3600_000),
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
  // Typed in pounds, stored in pence (Decision 334).
  await page.getByLabel('Price').fill('50');

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

/**
 * Decision 259 — new-member billing strategy. Fresh cycle (default, every
 * pre-existing plan) vs. Prorate to a shared renewal day, a School-Owner-
 * set-once-per-plan choice, SUBSCRIPTION only.
 */
test('a SUBSCRIPTION plan can switch to Prorate to a shared renewal day and back, with the renewal-day field required only while it is selected', async ({ page }) => {
  await page.goto('/membership-plans');
  await page.getByRole('button', { name: 'Add plan' }).click();
  await page.getByLabel('Title').fill('Shared Cycle Plan');
  await page.getByRole('button', { name: '2. Pricing & Access' }).click();
  await page.getByLabel('Price').fill('50');

  // Fresh cycle is the default — no renewal-day field yet.
  await expect(page.getByRole('button', { name: 'Fresh cycle from signup day' })).toBeVisible();
  await expect(page.getByLabel('Renewal day of month')).toHaveCount(0);

  // Selecting Prorate without a day blocks Save with a clear error.
  await page.getByRole('button', { name: 'Prorate to a shared renewal day' }).click();
  await expect(page.getByLabel('Renewal day of month')).toBeVisible();
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Set a renewal day of month/)).toBeVisible();

  // Filling it in lets the save go through.
  await page.getByRole('button', { name: '2. Pricing & Access' }).click();
  await page.getByLabel('Renewal day of month').fill('15');
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(/\/membership-plans$/);
  const created = await db.membershipPlan.findFirstOrThrow({ where: { schoolId: s.schoolId, title: 'Shared Cycle Plan' } });
  planIds.push(created.id);
  expect(created.newMemberBillingStrategy).toBe('PRORATED_TO_SHARED_CYCLE');
  expect(created.billingCycleAnchorDay).toBe(15);

  // Switching back to Fresh cycle on Edit clears the anchor day.
  await page.getByRole('row', { name: /Shared Cycle Plan/ }).getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: '2. Pricing & Access' }).click();
  await expect(page.getByLabel('Renewal day of month')).toHaveValue('15');
  await page.getByRole('button', { name: 'Fresh cycle from signup day' }).click();
  await expect(page.getByLabel('Renewal day of month')).toHaveCount(0);
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(/\/membership-plans$/);
  const updated = await db.membershipPlan.findUniqueOrThrow({ where: { id: created.id } });
  expect(updated.newMemberBillingStrategy).toBe('FRESH_CYCLE');
  expect(updated.billingCycleAnchorDay).toBeNull();
});

test('the new-member billing control is hidden for non-SUBSCRIPTION plan types', async ({ page }) => {
  await page.goto('/membership-plans');
  await page.getByRole('button', { name: 'Add plan' }).click();
  await page.getByRole('button', { name: '1. Basics' }).click();
  await page.getByLabel('Type').selectOption('CLASS_PACK');
  await page.getByRole('button', { name: '2. Pricing & Access' }).click();
  await expect(page.getByText('New member billing')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fresh cycle from signup day' })).toHaveCount(0);
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
  await page.getByLabel('Price').fill('20');
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

    await page.getByLabel('Price').fill('60');
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

// ---------------------------------------------------------------------------
// Decision 334 — the Memberships review of 26 Oct 2026.
// ---------------------------------------------------------------------------

test('a Trial must last 1-30 days, checked on Save from any step (M3)', async ({ page }) => {
  await page.goto('/membership-plans');
  await page.getByRole('button', { name: 'Add plan' }).click();
  await page.getByLabel('Type').selectOption('TRIAL_MEMBERSHIP');
  await page.getByLabel('Title').fill('Free trial');
  // Straight to Save without ever opening the Pricing step.
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('A Trial must last between 1 and 30 days.')).toBeVisible();
  // The error opens the step that needs fixing.
  await page.getByLabel('Expiry duration (days)').fill('45');
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('A Trial must last between 1 and 30 days.')).toBeVisible();

  await page.getByLabel('Expiry duration (days)').fill('14');
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/membership-plans$/);
  const created = await db.membershipPlan.findFirstOrThrow({ where: { schoolId: s.schoolId, title: 'Free trial' } });
  planIds.push(created.id);
  expect(created.expiryDurationDays).toBe(14);
});

test('a Class Pack needs its class count and a Weekly Pass its expiry (M4)', async ({ page }) => {
  await page.goto('/membership-plans');
  await page.getByRole('button', { name: 'Add plan' }).click();
  await page.getByLabel('Type').selectOption('CLASS_PACK');
  await page.getByLabel('Title').fill('Pack without count');
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('A Class Pack needs the number of classes it includes.')).toBeVisible();

  await page.getByRole('button', { name: '1. Basics' }).click();
  await page.getByLabel('Type').selectOption('WEEKLY_PASS');
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/A Weekly Pass needs an expiry/)).toBeVisible();
});

test('prices are typed in pounds and pence; text that is not an amount is refused (Q1)', async ({ page }) => {
  await page.goto('/membership-plans');
  await page.getByRole('button', { name: 'Add plan' }).click();
  await page.getByLabel('Type').selectOption('CLASS_PACK');
  await page.getByLabel('Title').fill('Pounds pack');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel(/Classes included/).fill('5');
  await page.getByLabel('Price').fill('12.345');
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Enter the price as an amount/)).toBeVisible();

  await page.getByLabel('Price').fill('12.50');
  await page.getByRole('button', { name: '3. Policies' }).click();
  await page.getByLabel('Cancellation charge').fill('5');
  await page.getByRole('button', { name: '5. Visibility' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/membership-plans$/);
  const created = await db.membershipPlan.findFirstOrThrow({ where: { schoolId: s.schoolId, title: 'Pounds pack' } });
  planIds.push(created.id);
  expect(created.price).toBe(1250);
  expect(created.cancellationCharge).toBe(500);

  // Shown back in pounds on Edit.
  await page.getByRole('row', { name: /Pounds pack/ }).getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: '2. Pricing & Access' }).click();
  await expect(page.getByLabel('Price')).toHaveValue('12.50');
});

test('the Type is locked while the plan has live members (M14)', async ({ page }) => {
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: 'Locked Pack', price: 1000, currency: 'GBP', classesIncluded: 5 },
  });
  planIds.push(plan.id);
  const live = await db.membership.create({
    data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: plan.id, schoolId: s.schoolId, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining: 3 },
  });
  try {
    await page.goto(`/membership-plans/${plan.id}/edit`);
    await expect(page.getByLabel('Type')).toBeDisabled();
    await expect(page.getByText(/1 active member is on this plan, so its type can't change/)).toBeVisible();
  } finally {
    await db.membership.delete({ where: { id: live.id } });
  }
});

test('every plan is listed, not just the first 20 (M5)', async ({ page }) => {
  const created = await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      db.membershipPlan.create({
        data: { id: randomUUID(), schoolId: s.schoolId, type: 'CLASS_PACK', title: `Bulk plan ${String(i + 1).padStart(2, '0')}`, price: 100, classesIncluded: 1 },
      }),
    ),
  );
  planIds.push(...created.map((p) => p.id));
  await page.goto('/membership-plans');
  await expect(page.getByTestId('stat-tile-Total plans').locator('span').nth(1)).toHaveText('25');
  for (const p of created) {
    await expect(page.getByRole('cell', { name: p.title, exact: true })).toBeVisible();
  }
});

test('Branch Staff see who manages plans instead of a blank page (M10)', async ({ page }) => {
  const staff = await addPerson('Bea', 'Staff', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId }]);
  await signIn(page, staff.token);
  await page.goto('/membership-plans');
  await expect(page.getByText('Only the School owner manages membership plans')).toBeVisible();
  await page.goto('/membership-plans/new');
  await expect(page.getByText('Only the School owner manages membership plans')).toBeVisible();
});
