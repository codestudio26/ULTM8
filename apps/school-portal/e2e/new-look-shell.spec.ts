import { mkdirSync } from 'fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { addPerson, cleanup, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The portal's app shell, the new look (NewLookShell.tsx; Decision 453: no
 * switch, no classic look). The side menu lists exactly the pages each person
 * may open (Shell.tsx's role and permission checks), grouped; phone width
 * shows the top bar; dark mode uses the Pine menu.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterAll(async () => {
  await cleanup();
});

/** Load a page and let the dev server finish serving it before the next one
 * (back-to-back loads can run Chromium out of request slots). */
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

const newMenu = (page: Page) => page.getByRole('navigation', { name: 'Main menu' });

async function hrefs(links: ReturnType<Page['locator']>): Promise<string[]> {
  return links.evaluateAll((els) => els.map((e) => new URL((e as HTMLAnchorElement).href).pathname));
}

/** Every page the new menu reaches: each group's link, and the tabs it shows. */
async function newLookPages(page: Page): Promise<{ rows: string[]; pages: string[] }> {
  const rowLinks = newMenu(page).locator('.u8n-nav__items a');
  const rows = await rowLinks.evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''));
  const targets = await hrefs(rowLinks);
  const pages = new Set<string>();
  for (const to of targets) {
    const row = newMenu(page).locator(`.u8n-nav__items a[href="${to}"]`);
    await row.click();
    await expect(page).toHaveURL(new RegExp(`${to}$`));
    // Pages load lazily: wait until the shell shows this group as current.
    await expect(row).toHaveAttribute('aria-current', 'page');
    await page.waitForLoadState('networkidle');
    pages.add(to);
    // The menu's own tabs, in the top bar (not a page header's section tabs).
    for (const tab of await hrefs(page.locator('.u8n-bar .u8n-tabs a'))) pages.add(tab);
  }
  return { rows, pages: [...pages].sort() };
}

/** The pages each person's menu offers (Shell.tsx's lists for these roles). */
const OWNER_PAGES = [
  '/billing-reports', '/branches', '/cancellations', '/classes', '/curriculum', '/dashboard', '/disciplines', '/franchises', '/grading',
  '/instructors', '/membership-plans', '/notifications', '/payroll', '/school', '/staff', '/students', '/timetable', '/transactions', '/waivers',
];
const COACH_PAGES = [
  '/check-in', '/classes', '/coach', '/complete-instructor-profile', '/curriculum', '/disciplines', '/grading', '/my-belts', '/notifications', '/students',
];
const FRONT_DESK_PAGES = [
  '/cancellations', '/check-in', '/classes', '/coach', '/curriculum', '/disciplines', '/grading', '/notifications', '/students', '/timetable',
];

test('the new look is always on: data-look on <html>, the side menu, Log out in the account menu', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await open(page, '/dashboard');
  await expect(page.locator('html')).toHaveAttribute('data-look', 'redesign');
  await expect(newMenu(page)).toBeVisible();
  await expect(page.locator('.ultm8-shell__sidebar')).toHaveCount(0);
  await expect(newMenu(page).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  await newMenu(page).getByRole('button', { name: /Olive Owner/ }).click();
  const menu = page.getByRole('menu', { name: 'Account' });
  await expect(menu.getByRole('menuitem', { name: 'My profile' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(3);
});

test("owner: the nine groups and Settings, reaching exactly the owner's pages", async ({ page }) => {
  await signIn(page, s.ownerToken);
  await open(page, '/dashboard');
  const { rows, pages } = await newLookPages(page);
  expect(rows).toEqual(['Dashboard', 'Students', 'Team', 'Schedule', 'Grading', 'Billing', 'Waivers', 'Organisation', 'Notifications']);
  expect(pages).toEqual(OWNER_PAGES);
  await expect(newMenu(page).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/school');

  // A group's other pages are tabs at the top of the page.
  await newMenu(page).getByRole('link', { name: 'Team' }).click();
  const tabs = page.getByRole('navigation', { name: 'Team pages' });
  await expect(tabs.getByRole('link', { name: 'Instructors' })).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('link', { name: 'Staff' }).click();
  await expect(page).toHaveURL(/\/staff$/);
  await expect(newMenu(page).getByRole('link', { name: 'Team' })).toHaveAttribute('aria-current', 'page');
});

test("coach: only the coach's own pages", async ({ page }) => {
  const coach = await addPerson('Cody', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await signIn(page, coach.token);
  await open(page, '/coach');
  const { rows, pages } = await newLookPages(page);
  expect(rows).toEqual(['Dashboard', 'Students', 'Schedule', 'Grading', 'My belts', 'My coach profile', 'Notifications']);
  expect(pages).toEqual(COACH_PAGES);
  // No Settings for a coach: the profile menu has no "School settings" for them either.
  await expect(newMenu(page).getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await expect(newMenu(page).getByRole('link', { name: 'Billing' })).toHaveCount(0);
});

test("front desk (Branch Staff): only the front desk's pages", async ({ page }) => {
  const staff = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId }]);
  await signIn(page, staff.token);
  await open(page, '/coach');
  const { rows, pages } = await newLookPages(page);
  expect(pages).toEqual(FRONT_DESK_PAGES);
  expect(rows).not.toContain('Billing');
  expect(rows).not.toContain('Organisation');
  expect(rows[0]).toBe('Dashboard');
  expect(rows[rows.length - 1]).toBe('Notifications');
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the menu becomes a top bar of sections; search and account stay reachable', async ({ page }) => {
    await signIn(page, s.ownerToken);
    await open(page, '/dashboard');
    const menu = newMenu(page);
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.y).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThan(380);
    expect(box.height).toBeLessThan(90);
    await expect(menu.getByRole('link', { name: 'Students' })).toBeVisible();
    await expect(menu.getByRole('combobox')).toBeHidden();
    // The account (and its Log out) moves to the tools row.
    await page.locator('.u8n-bar__tools').getByRole('button', { name: /Olive Owner/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
    // No sideways scroll on the page itself.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('the menu is Pine, the selected row is the darker Pine', async ({ page }) => {
    await signIn(page, s.ownerToken);
    await open(page, '/dashboard');
    const menu = newMenu(page);
    await expect(menu).toHaveCSS('background-color', 'rgb(31, 61, 51)');
    await expect(menu.getByRole('link', { name: 'Dashboard' })).toHaveCSS('background-color', 'rgb(44, 84, 70)');
  });
});

test('light mode: a white menu with the pale-green selected row', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await open(page, '/dashboard');
  await expect(newMenu(page)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(newMenu(page).getByRole('link', { name: 'Dashboard' })).toHaveCSS('background-color', 'rgb(222, 242, 226)');
});

/** Screenshots for the PR, only when NEW_LOOK_SHOTS names a folder. */
test.describe('screenshots', () => {
  test.skip(!process.env.NEW_LOOK_SHOTS, 'set NEW_LOOK_SHOTS to a folder to take them');

  async function shot(browser: Browser, token: string, path: string, name: string, opts: { width: number; height: number; dark?: boolean }) {
    const context = await browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: 2,
      colorScheme: opts.dark ? 'dark' : 'light',
    });
    const page = await context.newPage();
    await signIn(page, token);
    await page.goto(path);
    await expect(newMenu(page)).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${process.env.NEW_LOOK_SHOTS}/${name}.png` });
    await context.close();
  }

  test('owner and coach, light, dark and phone', async ({ browser }) => {
    test.setTimeout(120_000);
    mkdirSync(process.env.NEW_LOOK_SHOTS!, { recursive: true });
    const coach = await addPerson('Cody', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
    await shot(browser, s.ownerToken, '/dashboard', 'owner-light', { width: 1440, height: 900 });
    await shot(browser, s.ownerToken, '/dashboard', 'owner-dark', { width: 1440, height: 900, dark: true });
    await shot(browser, s.ownerToken, '/staff', 'owner-team-tabs-light', { width: 1440, height: 900 });
    await shot(browser, s.ownerToken, '/dashboard', 'owner-phone', { width: 390, height: 844 });
    await shot(browser, s.ownerToken, '/dashboard', 'owner-phone-dark', { width: 390, height: 844, dark: true });
    await shot(browser, coach.token, '/coach', 'coach-light', { width: 1440, height: 900 });
    await shot(browser, coach.token, '/coach', 'coach-dark', { width: 1440, height: 900, dark: true });
    await shot(browser, coach.token, '/coach', 'coach-phone', { width: 390, height: 844 });
  });
});
