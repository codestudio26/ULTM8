import { mkdirSync } from 'fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { addPerson, cleanup, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * New look rollout, PR 1: the app shell behind "Try the new look" (look.ts,
 * NewLookShell.tsx). Off by default, the classic shell is unchanged; on, the
 * new side menu lists exactly the pages the classic sidebar lists for that
 * person (owner, coach, front desk), grouped; phone width shows the top bar;
 * dark mode uses the Pine menu.
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

const classicNav = (page: Page) => page.locator('.ultm8-shell__sidebar nav');
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
    for (const tab of await hrefs(page.locator('.u8n-tabs a'))) pages.add(tab);
  }
  return { rows, pages: [...pages].sort() };
}

async function classicPages(page: Page): Promise<string[]> {
  await expect(classicNav(page).getByRole('link').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  return [...new Set(await hrefs(classicNav(page).getByRole('link')))].sort();
}

test('switch off by default: the classic shell, unchanged, with no data-look', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await open(page, '/dashboard');
  await expect(classicNav(page).getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(page.locator('.ultm8-shell__sidebar')).toContainText('Log out');
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-look'))).toBeNull();
  await expect(page.getByTestId('new-look-menu')).toHaveCount(0);
  await expect(page.getByRole('navigation')).toHaveCount(1);
});

test('the profile menu turns the new look on and off, remembered in this browser', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await open(page, '/dashboard');
  await page.getByRole('button', { name: /Olive Owner/ }).click();
  const toggle = page.getByRole('menuitemcheckbox', { name: /Try the new look/ });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();

  await expect(page.locator('html')).toHaveAttribute('data-look', 'redesign');
  await expect(newMenu(page)).toBeVisible();
  await expect(page.locator('.ultm8-shell__sidebar')).toHaveCount(0);
  await expect(newMenu(page).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');

  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('html')).toHaveAttribute('data-look', 'redesign');
  await expect(newMenu(page)).toBeVisible();

  // From the new shell the same menu item turns it back off.
  await newMenu(page).getByRole('button', { name: /Olive Owner/ }).click();
  await page.getByRole('menuitemcheckbox', { name: /Try the new look/ }).click();
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-look'))).toBeNull();
  await expect(classicNav(page)).toBeVisible();
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(classicNav(page)).toBeVisible();
});

test('?look=redesign and ?look=classic set the switch', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await open(page, '/dashboard?look=redesign');
  await expect(newMenu(page)).toBeVisible();
  await open(page, '/dashboard');
  await expect(newMenu(page)).toBeVisible();
  await open(page, '/dashboard?look=classic');
  await expect(classicNav(page)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('ultm8.look'))).toBeNull();
});

test("owner: the nine groups and Settings, reaching exactly the classic sidebar's pages", async ({ page }) => {
  await signIn(page, s.ownerToken);
  await open(page, '/dashboard');
  const classic = await classicPages(page);

  await open(page, '/dashboard?look=redesign');
  const { rows, pages } = await newLookPages(page);
  expect(rows).toEqual(['Dashboard', 'Students', 'Team', 'Schedule', 'Grading', 'Billing', 'Waivers', 'Organisation', 'Notifications']);
  expect(pages).toEqual(classic);
  await expect(newMenu(page).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/school');

  // A group's other pages are tabs at the top of the page.
  await newMenu(page).getByRole('link', { name: 'Team' }).click();
  const tabs = page.getByRole('navigation', { name: 'Team pages' });
  await expect(tabs.getByRole('link', { name: 'Instructors' })).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('link', { name: 'Staff' }).click();
  await expect(page).toHaveURL(/\/staff$/);
  await expect(newMenu(page).getByRole('link', { name: 'Team' })).toHaveAttribute('aria-current', 'page');
});

test("coach: only the coach's own pages, the same as the classic sidebar", async ({ page }) => {
  const coach = await addPerson('Cody', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await signIn(page, coach.token);
  await open(page, '/coach');
  const classic = await classicPages(page);

  await open(page, '/coach?look=redesign');
  const { rows, pages } = await newLookPages(page);
  expect(rows).toEqual(['Dashboard', 'Students', 'Schedule', 'Grading', 'My belts', 'My coach profile', 'Notifications']);
  expect(pages).toEqual(classic);
  // No Settings for a coach: the profile menu has no "School settings" for them either.
  await expect(newMenu(page).getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await expect(newMenu(page).getByRole('link', { name: 'Billing' })).toHaveCount(0);
});

test('front desk (Branch Staff): the same pages as the classic sidebar', async ({ page }) => {
  const staff = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId }]);
  await signIn(page, staff.token);
  await open(page, '/coach');
  const classic = await classicPages(page);

  await open(page, '/coach?look=redesign');
  const { rows, pages } = await newLookPages(page);
  expect(pages).toEqual(classic);
  expect(rows).not.toContain('Billing');
  expect(rows).not.toContain('Organisation');
  expect(rows[0]).toBe('Dashboard');
  expect(rows[rows.length - 1]).toBe('Notifications');
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the menu becomes a top bar of sections; search and account stay reachable', async ({ page }) => {
    await signIn(page, s.ownerToken);
    await open(page, '/dashboard?look=redesign');
    const menu = newMenu(page);
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.y).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThan(380);
    expect(box.height).toBeLessThan(90);
    await expect(menu.getByRole('link', { name: 'Students' })).toBeVisible();
    await expect(menu.getByRole('combobox')).toBeHidden();
    // The account (and its Log out / new-look switch) moves to the tools row.
    await page.locator('.u8n-bar__tools').getByRole('button', { name: /Olive Owner/ }).click();
    await expect(page.getByRole('menuitemcheckbox', { name: /Try the new look/ })).toHaveAttribute('aria-checked', 'true');
    // No sideways scroll on the page itself.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('the menu is Pine, the selected row is the darker Pine', async ({ page }) => {
    await signIn(page, s.ownerToken);
    await open(page, '/dashboard?look=redesign');
    const menu = newMenu(page);
    await expect(menu).toHaveCSS('background-color', 'rgb(31, 61, 51)');
    await expect(menu.getByRole('link', { name: 'Dashboard' })).toHaveCSS('background-color', 'rgb(44, 84, 70)');
  });
});

test('light mode: a white menu with the pale-green selected row', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await open(page, '/dashboard?look=redesign');
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
    await page.goto(`${path}?look=redesign`);
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
