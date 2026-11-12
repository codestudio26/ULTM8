import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { addBranch, addPerson, addStudent, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 461 item 4: Branch Staff with "See attendance statistics" get the
 * owner Dashboard's "Check-ins today" card (Decision 454 item 8) on their
 * coach dashboard, for their own Branches: the API scopes it, so the page
 * asks without a Branch and shows the total. Instructors who aren't Branch
 * Staff, and Branch Staff without that switch, see no card and the page never
 * asks for it (the API would answer 403).
 *
 * Fixture School (no time zone, so today is UTC's), Branches North and South:
 * Rey and Sam checked in to a North class today, Sol to a South class; Ina
 * booked at North but not checked in.
 */
let s: GradingSchool;
let north: { id: string };
let south: { id: string };

test.beforeEach(async () => {
  s = await seedGradingSchool();
  north = await addBranch(s, 'North');
  south = await addBranch(s, 'South');
  const rey = await addStudent(s, 'Rey', 'North', { rung: 'White 0' });
  const sol = await addStudent(s, 'Sol', 'South', { rung: 'White 0' });
  const ina = await addStudent(s, 'Ina', 'Booked', { rung: 'White 0' });

  const today = new Date();
  const dayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const mkClass = (branchId: string, minutes: number) =>
    db.class.create({
      data: { id: randomUUID(), schoolId: s.schoolId, branchId, title: 'Check-ins class', startDate: new Date(dayStart + minutes * 60_000), endDate: new Date(dayStart + (minutes + 60) * 60_000) },
    });
  const northClass = await mkClass(north.id, 1);
  const southClass = await mkClass(south.id, 2);
  const book = (studentId: string, cls: { id: string; branchId: string | null }, status: 'COMPLETED' | 'UPCOMING') =>
    db.booking.create({ data: { id: randomUUID(), studentId, classId: cls.id, schoolId: s.schoolId, branchId: cls.branchId, status, checkInMethod: status === 'COMPLETED' ? 'INSTRUCTOR_MANUAL' : null } });
  await Promise.all([book(rey.id, northClass, 'COMPLETED'), book(s.student.id, northClass, 'COMPLETED'), book(ina.id, northClass, 'UPCOMING'), book(sol.id, southClass, 'COMPLETED')]);
});

// Classes and bookings made here aren't cleaned by the shared cleanup.
test.afterEach(async () => {
  await db.booking.deleteMany({ where: { schoolId: s.schoolId } });
  await db.class.deleteMany({ where: { schoolId: s.schoolId } });
});

test.afterAll(async () => {
  await cleanup();
});

async function branchStaff(branchIds: string[], seesStats: boolean) {
  const staff = await addPerson(
    'Bea',
    'Staff',
    branchIds.map((branchId) => ({ role: 'BRANCH_STAFF' as const, schoolId: s.schoolId, branchId })),
  );
  await db.staffPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: staff.id, canSeeAttendanceStats: seesStats } });
  return staff;
}

/** Every request the page makes to GET …/attendance/today. */
function watchCheckInCalls(page: Page) {
  const calls: URL[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname === `/v1/schools/${s.schoolId}/attendance/today`) calls.push(url);
  });
  return calls;
}

const card = (page: Page) => page.getByTestId('stat-checkins');

test('Branch Staff with "See attendance statistics" land on their dashboard and see their Branch\'s check-ins today', async ({ page }) => {
  const staff = await branchStaff([north.id], true);
  const calls = watchCheckInCalls(page);
  await signIn(page, staff.token);
  await page.goto('/');
  await expect(page).toHaveURL(/\/coach$/);

  await expect(card(page)).toContainText('Check-ins today');
  await expect(card(page).locator('.u8n-dash__stat-value')).toHaveText('2');
  await expect(card(page)).toContainText('Across 1 class so far');
  // The owner's card: a plain number, no link.
  await expect(card(page).getByRole('link')).toHaveCount(0);
  // Asked with no Branch: the API scopes it to theirs.
  expect(calls.length).toBeGreaterThan(0);
  for (const url of calls) expect(url.searchParams.has('branchId')).toBe(false);

  // At the top of the main column, above the cards.
  const [c, grading] = await Promise.all([card(page).boundingBox(), page.getByRole('region', { name: 'Grading' }).boundingBox()]);
  expect(c!.y + c!.height).toBeLessThanOrEqual(grading!.y);
});

test('Branch Staff at two Branches see the total of both', async ({ page }) => {
  const staff = await branchStaff([north.id, south.id], true);
  const calls = watchCheckInCalls(page);
  await signIn(page, staff.token);
  await page.goto('/coach');

  await expect(card(page).locator('.u8n-dash__stat-value')).toHaveText('3');
  await expect(card(page)).toContainText('Across 2 classes so far');
  // No Branch picker of its own.
  await expect(card(page).getByRole('combobox')).toHaveCount(0);
  expect(calls.length).toBeGreaterThan(0);
  for (const url of calls) expect(url.searchParams.has('branchId')).toBe(false);
});

test('Branch Staff without "See attendance statistics" see no card, and the page never asks for it', async ({ page }) => {
  const staff = await branchStaff([north.id], false);
  const calls = watchCheckInCalls(page);
  await signIn(page, staff.token);
  await page.goto('/coach');

  await expect(page.getByRole('heading', { name: 'Coach dashboard' })).toBeVisible();
  // The page has finished: their branch's classes card and Birthdays are in.
  await expect(page.getByRole('region', { name: 'Classes at your branch this week' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Birthdays this week' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByText('Check-ins today')).toHaveCount(0);
  expect(calls).toHaveLength(0);
});

test('a coach who is not Branch Staff sees no card, and the page never asks for it', async ({ page }) => {
  const coach = await addPerson('Cody', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId, branchId: north.id }]);
  const calls = watchCheckInCalls(page);
  await signIn(page, coach.token);
  await page.goto('/coach');

  await expect(page.getByRole('heading', { name: 'Coach dashboard' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Birthdays this week' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByText('Check-ins today')).toHaveCount(0);
  expect(calls).toHaveLength(0);
});

test('on a phone the card fits: full width, no sideways scrolling, above the cards', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const staff = await branchStaff([north.id, south.id], true);
  await signIn(page, staff.token);
  await page.goto('/coach');

  await expect(card(page).locator('.u8n-dash__stat-value')).toHaveText('3');
  const [c, grading] = await Promise.all([card(page).boundingBox(), page.getByRole('region', { name: 'Grading' }).boundingBox()]);
  expect(c!.x).toBeGreaterThanOrEqual(0);
  expect(c!.x + c!.width).toBeLessThanOrEqual(390);
  // One column: as wide as the cards under it.
  expect(Math.abs(c!.width - grading!.width)).toBeLessThanOrEqual(1);
  expect(grading!.y).toBeGreaterThanOrEqual(c!.y + c!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('the card follows the dark colours', async ({ page }) => {
    const staff = await branchStaff([north.id], true);
    await signIn(page, staff.token);
    await page.goto('/coach');
    await expect(card(page).locator('.u8n-dash__stat-value')).toHaveText('2');
    expect(await card(page).evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 255, 255)');
    // Light text on the dark card.
    const colour = await card(page).locator('.u8n-dash__stat-value').evaluate((el) => getComputedStyle(el).color);
    const [r, g, b] = colour.match(/\d+/g)!.map(Number);
    expect(r + g + b).toBeGreaterThan(3 * 128);
  });
});

/** Screenshots for the PR, only when NEW_LOOK_SHOTS names a folder (as dashboard-tiles.spec.ts). */
test.describe('screenshots', () => {
  test.skip(!process.env.NEW_LOOK_SHOTS, 'set NEW_LOOK_SHOTS to a folder to take them');

  async function shot(browser: Browser, token: string, name: string, opts: { width: number; height: number; dark?: boolean }) {
    const context = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 2, colorScheme: opts.dark ? 'dark' : 'light' });
    const page = await context.newPage();
    await signIn(page, token);
    await page.goto('/coach');
    await expect(card(page).locator('.u8n-dash__stat-value')).toHaveText('3');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${process.env.NEW_LOOK_SHOTS}/${name}.png`, fullPage: true });
    await context.close();
  }

  test('Branch Staff: light, dark and phone', async ({ browser }) => {
    test.setTimeout(120_000);
    mkdirSync(process.env.NEW_LOOK_SHOTS!, { recursive: true });
    const staff = await branchStaff([north.id, south.id], true);
    await shot(browser, staff.token, 'branch-staff-light', { width: 1440, height: 900 });
    await shot(browser, staff.token, 'branch-staff-dark', { width: 1440, height: 900, dark: true });
    await shot(browser, staff.token, 'branch-staff-phone', { width: 390, height: 844 });
    await shot(browser, staff.token, 'branch-staff-phone-dark', { width: 390, height: 844, dark: true });
  });
});
