import { randomUUID, createHmac } from 'crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';
import { pickOption } from './team-helpers';

/**
 * The Organisation forms in the new look (Decision 460): Add branch, Branch
 * settings, Add/Edit franchise, the School page's setting cards and Create
 * your School (/onboarding). The dialogs keep the shared frame with their
 * buttons in the band at the foot (Cancel first); every browser `<select>` is
 * the new look's own drop-down (a pick counts as an edit, as a browser
 * select's change did), except the shared address Country/Region pickers,
 * which another change takes; Branch settings has the new page header. Look
 * only: the same fields, checks and API calls, which the branch, franchise,
 * school, charges and cancellation specs still cover.
 */
function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signToken(payload: object): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET is not set');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify({ ...payload, iat: now, exp: now + 3600 }));
  const signature = base64url(createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${signature}`;
}

const band = (dialog: Locator) => dialog.locator('.ultm8-modal__actions').getByRole('button');
const closeButton = (dialog: Locator) => dialog.locator('.ultm8-modal__head').getByRole('button', { name: 'Close dialog' });
/** Browser `<select>`s other than the shared address Country/Region pickers. */
const ownSelects = (scope: Locator) => scope.locator('select:not([id$="-country"]):not([id$="-region"])');
const main = (page: Page) => page.locator('.u8o');

/** The band is the dialog's last row: nothing comes after it. */
async function expectBandLast(dialog: Locator) {
  const last = dialog.locator('.ultm8-modal__body').locator(':scope > *, :scope > form > *').last();
  await expect(last).toHaveClass(/ultm8-modal__actions/);
}

/** Nothing scrolls the page sideways. */
async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('School and Branches', () => {
  let s: GradingSchool;
  const branchIds: string[] = [];

  test.beforeEach(async () => {
    s = await seedGradingSchool();
  });
  test.afterEach(async () => {
    await db.branch.deleteMany({ where: { id: { in: branchIds } } });
    branchIds.length = 0;
  });
  test.afterAll(async () => {
    await cleanup();
  });

  test('Add branch: Cancel then Save in the band, no browser drop-down of its own, and the ✕ closes it', async ({ page }) => {
    await signIn(page, s.ownerToken);
    await page.goto('/branches');
    await page.getByRole('button', { name: 'Add branch' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add branch' });
    await expect(dialog).toBeVisible();
    await expect(ownSelects(dialog)).toHaveCount(0);
    await expect(band(dialog)).toHaveText(['Cancel', 'Save']);
    await expectBandLast(dialog);
    await closeButton(dialog).click();
    await expect(dialog).toHaveCount(0);
  });

  test('Branch settings: the new page header, our own drop-downs, and the language picked is saved', async ({ page }) => {
    const branch = await addBranch(s, 'Forms North');
    branchIds.push(branch.id);
    await signIn(page, s.ownerToken);
    await page.goto(`/branches/${branch.id}`);

    await expect(page.getByRole('heading', { level: 1, name: 'Forms North' })).toBeVisible();
    await expect(page.locator('.u8n-page-header__parent')).toHaveAttribute('href', '/branches');
    await expect(page.locator('.u8n-page-header__parent')).toHaveText('‹ Back to Branches');
    await expect(page.locator('.ultm8-page-header')).toHaveCount(0);
    await expect(ownSelects(main(page))).toHaveCount(0);
    for (const name of ['Default language', 'Settings for this branch', 'Tax lines', 'Class cancellation policy', 'When the policy applies', 'When the school cancels a whole class']) {
      await expect(main(page).getByRole('combobox', { name, exact: true })).toBeVisible();
    }
    // Same as the School: the School's values, read-only, until "own" is picked.
    await expect(main(page).getByRole('combobox', { name: 'Class cancellation policy' })).toBeDisabled();

    await pickOption(page, 'Default language', 'English (UK)');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Branch settings saved.')).toBeVisible();
    expect((await db.branch.findUniqueOrThrow({ where: { id: branch.id } })).defaultLanguage).toBe('en-GB');
  });

  test("the School page: every setting card's drop-down is our own, and Stripe's status is a tag", async ({ page }) => {
    await signIn(page, s.ownerToken);
    await page.goto('/school');
    await expect(page.getByRole('heading', { level: 1, name: 'School profile' })).toBeVisible();
    await expect(page.getByTestId('school-stripe-connect-status')).toBeVisible();

    await expect(ownSelects(main(page))).toHaveCount(0);
    for (const name of [
      'Default language',
      'Check-in code length',
      'Timetable week starts on',
      'Timetable opens as',
      'Class cancellation policy',
      'When the policy applies',
      'When the school cancels a whole class',
      'Cancelling after a class starts',
      'Country your School is in',
      'Your prices',
    ]) {
      await expect(main(page).getByRole('combobox', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('school-stripe-connect-status').locator('.u8n-tag')).toHaveText('Not connected');
    await expect(page.getByTestId('school-stripe-connect-status').locator('.ultm8-badge')).toHaveCount(0);

    // A pick is saved as the browser select's choice was.
    await pickOption(main(page), 'Check-in code length', '6 digits');
    await main(page).getByRole('button', { name: 'Save changes' }).first().click();
    await expect(main(page).getByText('Saved.').first()).toBeVisible();
    expect((await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).checkInCodeDigits).toBe(6);
  });

  test('the School page and Branch settings fit a phone', async ({ page }) => {
    const branch = await addBranch(s, 'Forms Phone');
    branchIds.push(branch.id);
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, s.ownerToken);
    await page.goto('/school');
    await expect(main(page).getByRole('combobox', { name: 'Country your School is in' })).toBeVisible();
    await expectNoSideScroll(page);
    await page.goto(`/branches/${branch.id}`);
    await expect(main(page).getByRole('combobox', { name: 'Default language' })).toBeVisible();
    await expectNoSideScroll(page);
  });
});

test.describe('Franchise form', () => {
  let franchiseId: string;
  let ownerId: string;

  test.beforeEach(async ({ page }) => {
    const owner = await addPerson('Frida', 'Franchise');
    ownerId = owner.id;
    const franchise = await db.franchise.create({
      data: { id: randomUUID(), name: `Forms Co ${randomUUID().slice(0, 8)}`, feeModel: 'FLAT', flatFeeAmount: 5000, activities: [`FormsE2E-${randomUUID()}`] },
    });
    franchiseId = franchise.id;
    await db.roleGrant.create({ data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: owner.id, franchiseId } });
    await signIn(page, signToken({ sub: owner.id, email: owner.email, grants: [{ role: 'FRANCHISE_OWNER', franchiseId, schoolId: null, branchId: null }] }));
  });
  test.afterEach(async () => {
    await db.roleGrant.deleteMany({ where: { franchiseId } });
    await db.franchise.deleteMany({ where: { id: franchiseId } });
    await db.user.deleteMany({ where: { id: ownerId } });
  });
  test.afterAll(async () => {
    await cleanup();
  });

  test('Add franchise: our own drop-downs, Cancel then Save in the band, a pick counts as an edit, and it fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/franchises');
    await page.getByRole('button', { name: 'Add franchise' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add franchise' });
    await expect(dialog).toBeVisible();
    await expect(ownSelects(dialog)).toHaveCount(0);
    await expect(dialog.getByRole('combobox', { name: 'Default language', exact: true })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Fee model', exact: true })).toBeVisible();
    await expect(band(dialog)).toHaveText(['Cancel', 'Save']);
    await expectBandLast(dialog);
    await expectNoSideScroll(page);
    // On a phone the dialog fills the screen and its white sheet grows with
    // the long form, so nothing of the page behind shows through once scrolled.
    const sheet = await page.locator('.ultm8-modal').evaluate((el) => ({ height: Math.ceil(el.getBoundingClientRect().height), content: el.scrollHeight, screen: window.innerHeight }));
    expect(sheet.height).toBeGreaterThanOrEqual(sheet.screen);
    expect(sheet.height).toBeGreaterThanOrEqual(sheet.content);

    // Nothing typed yet: Escape closes it.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // A pick is an edit: Escape and a click outside keep the form.
    await page.getByRole('button', { name: 'Add franchise' }).first().click();
    await expect(dialog).toBeVisible();
    await pickOption(dialog, 'Fee model', 'Per-headcount');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(dialog).toBeVisible();
    // The ✕ does what Cancel does.
    await closeButton(dialog).click();
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('Create your School', () => {
  let userId: string;
  test.afterEach(async () => {
    await db.user.deleteMany({ where: { id: userId } });
  });
  test.afterAll(async () => {
    await cleanup();
  });

  test('/onboarding: our own drop-downs and no side scroll on a phone', async ({ page }) => {
    const nobody = await addPerson('Olly', 'Onboarding');
    userId = nobody.id;
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, nobody.token);
    await page.goto('/onboarding');
    await expect(page.getByLabel('School name')).toBeVisible();
    await expect(ownSelects(page.locator('form'))).toHaveCount(0);
    await pickOption(page, 'Class cancellation policy', 'Auto-credit');
    await expect(page.getByRole('combobox', { name: 'Class cancellation policy' }).locator('[data-shown="true"]')).toHaveText('Auto-credit');
    await expect(page.getByRole('combobox', { name: 'Default language', exact: true })).toBeVisible();
    await expectNoSideScroll(page);
  });
});
