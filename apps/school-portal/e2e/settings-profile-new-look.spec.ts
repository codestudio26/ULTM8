import { randomUUID } from 'crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';
import { pickOption } from './team-helpers';

/**
 * The settings and profile forms in the new look (Decision 460 item 17): My
 * profile (with My roles here), Check-in rules and My belts. Look only: the
 * same fields, values, access and API calls, which my-profile, front-desk,
 * schedule-sharing, sign-in-review and instructor-belts still cover.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterAll(async () => {
  await cleanup();
});

/** The page's own header is the new look's, and no old one is left. */
async function expectNewHeader(page: Page, title: string) {
  await expect(page.locator('.u8n-page-header').getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.locator('.ultm8-page-header')).toHaveCount(0);
  await expect(page.locator('.u8n-page .ultm8-card')).toHaveCount(0);
}

/** No browser drop-down is left on the page. The shared address fields are
 * left out: their Country/Region pickers move to the new look in their own
 * change (group 8). */
async function expectNoBrowserSelect(page: Page) {
  const left = await page.evaluate(() => Array.from(document.querySelectorAll('.u8n-page select')).filter((el) => !el.closest('.ultm8-address')).length);
  expect(left).toBe(0);
}

/** Records the `input` events that reach `scope`, as a browser <select>'s change did. */
async function watchInput(scope: Locator) {
  await scope.evaluate((el) => {
    (window as unknown as { __edits: number }).__edits = 0;
    el.addEventListener('input', () => {
      (window as unknown as { __edits: number }).__edits += 1;
    });
  });
}
/** The value a new-look drop-down shows (it holds every option, only the chosen one shown). */
const shown = (combobox: Locator) => combobox.locator('[data-shown="true"]');

const edits = (page: Page) => page.evaluate(() => (window as unknown as { __edits: number }).__edits);

/** Nothing scrolls the page sideways. */
async function expectFits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test('My profile: the new header, the fields in chapters, Language as the new drop-down; a pick counts as an edit', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/profile');
  await expectNewHeader(page, 'My profile');
  await expect(page.locator('.u8n-page-header').getByText('Olive Owner')).toBeVisible();
  for (const chapter of ['Personal details', 'Address', 'Change passcode']) {
    await expect(page.getByRole('heading', { level: 2, name: chapter, exact: true })).toBeVisible();
  }
  await expectNoBrowserSelect(page);

  const personal = page.getByRole('group', { name: 'Personal details' });
  await expect(shown(personal.getByRole('combobox', { name: 'Language', exact: true }))).toHaveText('Not set');
  await watchInput(page.locator('form', { has: personal }));
  await pickOption(personal, 'Language', 'Spanish');
  expect(await edits(page)).toBe(1);
  await expect(shown(personal.getByRole('combobox', { name: 'Language', exact: true }))).toHaveText('Spanish');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(async () => (await db.user.findUniqueOrThrow({ where: { id: s.ownerId } })).language).toBe('es');
});

test('a coach: My profile in the new look with My roles here; Give up opens the new-look dialog', async ({ page }) => {
  const coach = await addPerson('Cody', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  try {
    await signIn(page, coach.token);
    await page.goto('/profile');
    await expectNewHeader(page, 'My profile');
    await expectNoBrowserSelect(page);

    const roles = page.getByRole('region', { name: 'My roles here' });
    await expect(roles.getByRole('heading', { level: 2, name: 'My roles here' })).toBeVisible();
    await expect(roles.getByRole('listitem')).toHaveCount(1);
    await expect(roles.getByRole('listitem')).toContainText('Instructor');
    await roles.getByRole('button', { name: 'Give up' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeVisible();
    await expect(dialog.locator('.ultm8-modal__actions').getByRole('button')).toHaveText(['Cancel', 'Give up']);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    // Nothing given up.
    expect(await db.roleGrant.count({ where: { userId: coach.id, revokedAt: null } })).toBe(1);
  } finally {
    await db.roleGrant.deleteMany({ where: { userId: coach.id } });
  }
});

test('Check-in rules: the new header, the settings in cards, the new drop-downs; a pick counts as an edit and saves', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/check-in');
  await page.getByRole('link', { name: 'Check-in rules' }).click();
  await expect(page).toHaveURL(/\/check-in\/rules$/);
  await expectNewHeader(page, 'Check-in rules');
  await expect(page.locator('.u8n-page-header').getByRole('link', { name: 'Back to check-in' })).toHaveAttribute('href', '/check-in');
  await expectNoBrowserSelect(page);

  const form = page.getByTestId('check-in-rules');
  for (const group of ['When', 'Who', 'Front desk']) {
    await expect(form.getByRole('region', { name: group })).toBeVisible();
  }
  await expect(shown(form.getByRole('region', { name: 'When' }).getByRole('combobox', { name: 'Check-in closes', exact: true }))).toHaveText('When the class ends');
  await expect(shown(form.getByRole('region', { name: 'Who' }).getByRole('combobox', { name: 'Block check-in for overdue payments', exact: true }))).toHaveText('No');
  await expect(shown(form.getByRole('region', { name: 'Front desk' }).getByRole('combobox', { name: 'Code length', exact: true }))).toHaveText('4 digits');

  // Saved once, then a pick is an edit: it fires `input` and the "saved" note goes.
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Check-in rules saved.')).toBeVisible();
  await watchInput(form);
  await pickOption(form, 'Block check-in for overdue payments', 'After 7 days');
  expect(await edits(page)).toBe(1);
  await expect(page.getByText('Check-in rules saved.')).toHaveCount(0);
  await pickOption(form, 'Check-in closes', 'A set time after the start');
  await form.getByLabel('Minutes after the start (0 = at the start)').fill('10');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Check-in rules saved.')).toBeVisible();
  const school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(school.checkInBlockOverdueDays).toBe(7);
  expect(school.checkInClosesMinutesAfterStart).toBe(10);
});

test('Branch Staff the owner allows still reach Check-in rules from Check-in, in the new look', async ({ page }) => {
  const north = await addBranch(s, 'North');
  const staff = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  await db.staffPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: staff.id, canManageCheckInRules: true } });
  try {
    await signIn(page, staff.token);
    await page.goto('/check-in');
    await page.getByRole('link', { name: 'Check-in rules' }).click();
    await expectNewHeader(page, 'Check-in rules');
    await expectNoBrowserSelect(page);
    await pickOption(page.getByTestId('check-in-rules'), 'Code length', '6 digits');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Check-in rules saved.')).toBeVisible();
    expect((await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).checkInCodeDigits).toBe(6);
  } finally {
    await db.staffPermission.deleteMany({ where: { userId: staff.id } });
    await db.roleGrant.deleteMany({ where: { userId: staff.id } });
  }
});

test('My belts: the new header, a card per style, the belt drop-down with belt pictures; a pick counts as an edit', async ({ page }) => {
  const coach = await addPerson('Cody', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  try {
    await signIn(page, coach.token);
    await page.goto('/my-belts');
    await expectNewHeader(page, 'My belts');
    await expectNoBrowserSelect(page);

    const card = page.locator('.u8t-card', { has: page.getByRole('heading', { level: 2, name: 'BJJ', exact: true }) });
    const picker = card.getByRole('combobox', { name: 'Your belt in BJJ' });
    await expect(picker).toHaveText(/Choose your belt…/);
    const save = card.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();

    await watchInput(card.locator('form'));
    await picker.click();
    const options = card.getByRole('option');
    await expect(options).toHaveText(['White 0', 'White 1', 'White 2', 'Blue 0']);
    // Every option shows its belt picture (DESIGN.md → "Drop-downs").
    for (const option of await options.all()) {
      await expect(option.locator('span[aria-hidden="true"]').first()).toBeVisible();
    }
    await card.getByRole('option', { name: 'White 1', exact: true }).click();
    expect(await edits(page)).toBe(1);
    await expect(picker).toHaveText(/White 1/);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(card.getByText('Saved. The School owner will verify it.')).toBeVisible();
    await expect(card.locator('.u8t-cardbar').getByText('Not verified')).toBeVisible();
    expect((await db.instructorBelt.findFirstOrThrow({ where: { userId: coach.id } })).stripeTierId).toBe(s.rung['White 1'].id);
  } finally {
    await db.instructorBelt.deleteMany({ where: { userId: coach.id } });
    await db.roleGrant.deleteMany({ where: { userId: coach.id } });
  }
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the owner: My profile and Check-in rules fit the screen, one field per row', async ({ page }) => {
    await signIn(page, s.ownerToken);
    await page.goto('/profile');
    await expect(page.getByRole('group', { name: 'Personal details' })).toBeVisible();
    await expectFits(page);
    const first = await page.getByLabel('First name').boundingBox();
    const surname = await page.getByLabel('Surname').boundingBox();
    expect(surname!.y).toBeGreaterThan(first!.y);

    await page.goto('/check-in/rules');
    await expect(page.getByTestId('check-in-rules')).toBeVisible();
    await expectFits(page);
    const opens = await page.getByLabel('Check-in opens (minutes before the class starts)').boundingBox();
    const closes = await page.getByRole('combobox', { name: 'Check-in closes', exact: true }).boundingBox();
    expect(closes!.y).toBeGreaterThan(opens!.y);
    await page.getByRole('combobox', { name: 'Block check-in for overdue payments', exact: true }).click();
    await expectFits(page);
  });

  test('a coach: My profile and My belts fit the screen', async ({ page }) => {
    const coach = await addPerson('Cody', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
    try {
      await signIn(page, coach.token);
      await page.goto('/profile');
      await expect(page.getByRole('region', { name: 'My roles here' })).toBeVisible();
      await expectFits(page);
      await page.goto('/my-belts');
      const picker = page.getByRole('combobox', { name: 'Your belt in BJJ' });
      await picker.click();
      await expect(page.getByRole('option', { name: 'Blue 0', exact: true })).toBeVisible();
      await expectFits(page);
    } finally {
      await db.roleGrant.deleteMany({ where: { userId: coach.id } });
    }
  });
});
