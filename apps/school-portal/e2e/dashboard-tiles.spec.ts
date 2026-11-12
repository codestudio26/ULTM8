import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { addBranch, addPerson, addStudent, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 454 item 8: the owner's Dashboard gets "Check-ins today" (a number
 * card, as the design draws it, under "Across N classes so far") and "Ready to
 * grade" (one list, its header carrying the count as "See all N →", which
 * opens the Grading Board; DESIGN.md → "Dashboard: nothing shown twice").
 *
 * Fixture School (no time zone, so today is UTC's), Branches North and South:
 * - Ready to grade: Rey (North) and Sol (South), both attending. Not Sam (the
 *   fixture student, 50%: his skill isn't signed off) and not Ina (ready but
 *   not attending, so the board's "Currently attending only" leaves her out).
 * - Check-ins today: Rey and Sam at a North class, Sol at a South class; Ina
 *   booked at North but not checked in.
 */
let s: GradingSchool;
let north: { id: string };
let south: { id: string };
const created = { plan: '', memberships: [] as string[], classes: [] as string[], bookings: [] as string[] };
let rey: { id: string; name: string };
let sol: { id: string; name: string };

test.beforeEach(async () => {
  s = await seedGradingSchool();
  north = await addBranch(s, 'North');
  south = await addBranch(s, 'South');
  rey = await addStudent(s, 'Rey', 'Ready', { rung: 'White 0', classes: 3 });
  sol = await addStudent(s, 'Sol', 'South', { rung: 'White 0', classes: 3 });
  const ina = await addStudent(s, 'Ina', 'Inactive', { rung: 'White 0', classes: 3 });
  await db.studentHomeBranch.createMany({
    data: [
      { id: randomUUID(), schoolId: s.schoolId, studentId: rey.id, branchId: north.id },
      { id: randomUUID(), schoolId: s.schoolId, studentId: ina.id, branchId: north.id },
      { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, branchId: north.id },
      { id: randomUUID(), schoolId: s.schoolId, studentId: sol.id, branchId: south.id },
    ],
  });

  // Attending: a live Subscription (Ina has none).
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
  created.plan = plan.id;
  created.memberships = [];
  for (const id of [rey.id, sol.id, s.student.id]) {
    const m = await db.membership.create({ data: { id: randomUUID(), studentId: id, membershipPlanId: plan.id, schoolId: s.schoolId, status: 'ACTIVE', frequency: 'RECURRING' } });
    created.memberships.push(m.id);
  }

  // Today's classes (UTC: the School has no time zone).
  const today = new Date();
  const dayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const mkClass = (branchId: string, minutes: number) =>
    db.class.create({
      data: { id: randomUUID(), schoolId: s.schoolId, branchId, title: 'Tiles class', startDate: new Date(dayStart + minutes * 60_000), endDate: new Date(dayStart + (minutes + 60) * 60_000) },
    });
  const northClass = await mkClass(north.id, 1);
  const southClass = await mkClass(south.id, 2);
  created.classes = [northClass.id, southClass.id];
  const book = (studentId: string, cls: { id: string; branchId: string | null }, status: 'COMPLETED' | 'UPCOMING') =>
    db.booking.create({ data: { id: randomUUID(), studentId, classId: cls.id, schoolId: s.schoolId, branchId: cls.branchId, status, checkInMethod: status === 'COMPLETED' ? 'INSTRUCTOR_MANUAL' : null } });
  created.bookings = (
    await Promise.all([book(rey.id, northClass, 'COMPLETED'), book(s.student.id, northClass, 'COMPLETED'), book(ina.id, northClass, 'UPCOMING'), book(sol.id, southClass, 'COMPLETED')])
  ).map((b) => b.id);
});

test.afterEach(async () => {
  await db.booking.deleteMany({ where: { id: { in: created.bookings } } });
  await db.class.deleteMany({ where: { id: { in: created.classes } } });
  await db.membership.deleteMany({ where: { id: { in: created.memberships } } });
  await db.membershipPlan.deleteMany({ where: { id: created.plan } });
});

test.afterAll(async () => {
  await cleanup();
});

const readyCard = (page: Page) => page.getByRole('region', { name: 'Ready to grade' });

test('the owner sees Check-ins today and the Ready to grade list with the right numbers', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');

  const checkIns = page.getByTestId('stat-checkins');
  await expect(checkIns).toContainText('Check-ins today');
  await expect(checkIns.locator('.u8n-dash__stat-value')).toHaveText('3');
  await expect(checkIns).toContainText('Across 2 classes so far');
  // The design draws it as a plain number card, with no link.
  await expect(checkIns.getByRole('link')).toHaveCount(0);

  const ready = readyCard(page);
  await expect(ready.getByRole('heading', { name: 'Ready to grade' })).toBeVisible();
  await expect(ready.getByRole('link', { name: 'See all 2 →' })).toHaveAttribute('href', '/grading');
  const rows = ready.getByTestId('ready-row');
  await expect(rows).toHaveCount(2);
  await expect(ready).toContainText(rey.name);
  await expect(ready).toContainText(sol.name);
  await expect(rows.first()).toContainText('White 0 → White 1');
  await expect(ready).not.toContainText(s.student.name); // 50%: not ready
  await expect(ready).not.toContainText('Ina Inactive'); // ready, but not attending
});

test('the Branch filter narrows Check-ins today to that Branch; Ready to grade says it is the whole School', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');
  const picker = page.getByRole('combobox', { name: 'Branch' });
  await picker.click();
  await page.getByRole('option', { name: 'North' }).click();
  await expect(page).toHaveURL(new RegExp(`branch=${north.id}`));

  const checkIns = page.getByTestId('stat-checkins');
  await expect(checkIns.locator('.u8n-dash__stat-value')).toHaveText('2');
  await expect(checkIns).toContainText('Across 1 class so far');
  const ready = readyCard(page);
  await expect(ready).toContainText('Whole School');
  await expect(ready.getByTestId('ready-row')).toHaveCount(2);
});

test('the links: "See all N →" opens the Grading Board, a student opens their Ranks tab at that style', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');
  const ready = readyCard(page);
  const reyRow = ready.getByTestId('ready-row').filter({ hasText: rey.name });
  await expect(reyRow).toHaveAttribute('href', `/students/${rey.id}?tab=ranks#grading-${s.disciplineId}`);

  await ready.getByRole('link', { name: 'See all 2 →' }).click();
  await expect(page).toHaveURL(/\/grading$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Grading Board' })).toBeVisible();

  await page.goBack();
  await readyCard(page).getByTestId('ready-row').filter({ hasText: rey.name }).click();
  await expect(page).toHaveURL(new RegExp(`/students/${rey.id}\\?tab=ranks#grading-${s.disciplineId}$`));
});

test('nobody ready: the list says so, with no "See all"', async ({ page }) => {
  await db.membership.deleteMany({ where: { id: { in: created.memberships } } });
  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');
  const ready = readyCard(page);
  await expect(ready).toContainText('No one is ready to grade.');
  await expect(ready.getByRole('link')).toHaveCount(0);
});

test('Branch Staff: the Dashboard stays the owner\'s, and the two numbers they may read are their own Branch\'s', async ({ page }) => {
  const staff = await addPerson('Bea', 'Staff', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  await db.gradingPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: staff.id, disciplineId: s.disciplineId } });
  await db.staffPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: staff.id, canSeeAttendanceStats: true } });
  await signIn(page, staff.token);

  // Decision 367 item 6 (Coaches review CP5): only the owner has this Dashboard.
  const apiCall = page.waitForRequest((r) => r.url().includes('/v1/'));
  await page.goto('/dashboard');
  await expect(page).not.toHaveURL(/\/dashboard/);
  // They land on their coach dashboard: none of the owner's number cards or
  // lists, only (Decision 461 item 4) their own Branch's "Check-ins today".
  await expect(page).toHaveURL(/\/coach$/);
  await expect(page.getByTestId('stat-checkins').locator('.u8n-dash__stat-value')).toHaveText('2');
  await expect(page.getByTestId('stat-bookings')).toHaveCount(0);
  await expect(page.getByTestId('stat-active')).toHaveCount(0);
  await expect(page.getByTestId('ready-list')).toHaveCount(0);

  // The API gives Branch Staff only their own Branch: North's ready student
  // and North's check-ins, never South's.
  const api = new URL((await apiCall).url()).origin;
  const headers = { Authorization: `Bearer ${staff.token}` };
  const ready = await (await page.request.get(`${api}/v1/schools/${s.schoolId}/grading-board/ready`, { headers })).json();
  expect(ready.total).toBe(1);
  expect(ready.items.map((i: { studentId: string }) => i.studentId)).toEqual([rey.id]);
  const today = await (await page.request.get(`${api}/v1/schools/${s.schoolId}/attendance/today`, { headers })).json();
  expect(today).toMatchObject({ branchIds: [north.id], checkIns: 2, classes: 1 });
  expect((await page.request.get(`${api}/v1/schools/${s.schoolId}/attendance/today?branchId=${south.id}`, { headers })).status()).toBe(403);
});

test('on a phone the two fit: no sideways scrolling, the list below the number cards', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');
  const checkIns = page.getByTestId('stat-checkins');
  const ready = readyCard(page);
  await expect(checkIns.locator('.u8n-dash__stat-value')).toHaveText('3');
  await expect(ready.getByTestId('ready-row')).toHaveCount(2);
  const [c, r] = await Promise.all([checkIns.boundingBox(), ready.boundingBox()]);
  expect(r!.y).toBeGreaterThan(c!.y + c!.height);
  expect(r!.x).toBeGreaterThanOrEqual(0);
  expect(r!.x + r!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // Each row is a full-width tap target.
  const row = await ready.getByTestId('ready-row').first().boundingBox();
  expect(row!.height).toBeGreaterThanOrEqual(44);
});

test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('both follow the dark colours', async ({ page }) => {
    await signIn(page, s.ownerToken);
    await page.goto('/dashboard');
    const ready = readyCard(page);
    await expect(ready.getByTestId('ready-row')).toHaveCount(2);
    const bg = (sel: ReturnType<Page['locator']>) => sel.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg(ready)).not.toBe('rgb(255, 255, 255)');
    expect(await bg(page.getByTestId('stat-checkins'))).not.toBe('rgb(255, 255, 255)');
    // Light text on the dark card.
    const colour = await ready.getByTestId('ready-row').first().evaluate((el) => getComputedStyle(el).color);
    const [r, g, b] = colour.match(/\d+/g)!.map(Number);
    expect(r + g + b).toBeGreaterThan(3 * 128);
  });
});

/** Screenshots for the PR, only when NEW_LOOK_SHOTS names a folder. */
test.describe('screenshots', () => {
  test.skip(!process.env.NEW_LOOK_SHOTS, 'set NEW_LOOK_SHOTS to a folder to take them');

  async function shot(browser: Browser, name: string, opts: { width: number; height: number; dark?: boolean }) {
    const context = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 2, colorScheme: opts.dark ? 'dark' : 'light' });
    const page = await context.newPage();
    await signIn(page, s.ownerToken);
    await page.goto('/dashboard');
    await expect(readyCard(page).getByTestId('ready-row')).toHaveCount(2);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${process.env.NEW_LOOK_SHOTS}/${name}.png`, fullPage: true });
    await context.close();
  }

  test('owner: light, dark and phone', async ({ browser }) => {
    test.setTimeout(120_000);
    mkdirSync(process.env.NEW_LOOK_SHOTS!, { recursive: true });
    await shot(browser, 'owner-light', { width: 1440, height: 900 });
    await shot(browser, 'owner-dark', { width: 1440, height: 900, dark: true });
    await shot(browser, 'owner-tablet', { width: 820, height: 1180 });
    await shot(browser, 'owner-phone', { width: 390, height: 844 });
    await shot(browser, 'owner-phone-dark', { width: 390, height: 844, dark: true });
  });
});
