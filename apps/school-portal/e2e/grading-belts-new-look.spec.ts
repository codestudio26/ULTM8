import { expect, test, type Locator, type Page } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';
import { pickOption } from './team-helpers';

/**
 * Belts, styles and skills in the new look (Decision 453, Decision 460; forms
 * group 9b): Styles & Belts, a style's page with its ladder, Grading → Skills,
 * and their dialogs (add / edit style, start from template, duplicate, the
 * belt editor and the reorder confirmations). Look only: the dialogs' own
 * specs (belt-editor, ladder-editor, style-templates, disciplines-review,
 * rank-levels, kids-adult-programs) still cover what each one saves.
 *
 * Seed: BJJ, White 0 → White 1 → White 2 → Blue 0; Sam Lee holds White 1.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

const band = (dialog: Locator) => dialog.locator('.ultm8-modal__actions').getByRole('button');

async function fitsTheScreen(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

/** The new header with the Grading tabs, the current one marked; no old header. */
async function expectGradingHeader(page: Page, title: string, current: string) {
  const header = page.locator('.u8n-page-header');
  await expect(header.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(header.getByRole('navigation', { name: 'Grading' }).getByRole('link', { name: current })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.ultm8-page-header')).toHaveCount(0);
  await expect(page.locator('main select')).toHaveCount(0);
}

test('Styles & Belts: the new header, and the style dialogs with new drop-downs, option cards and the band, Cancel first', async ({ page }) => {
  await page.goto('/disciplines');
  await expectGradingHeader(page, 'Disciplines', 'Styles & Belts');
  await expect(page.getByRole('group', { name: 'Style', exact: true }).getByRole('button', { name: 'BJJ', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Add discipline: no browser <select>; a pick counts as an edit.
  await page.getByRole('button', { name: 'Add discipline' }).click();
  const add = page.getByRole('dialog', { name: 'Add discipline' });
  await expect(add.locator('select')).toHaveCount(0);
  await expect(band(add)).toHaveText(['Cancel', 'Save']);
  await pickOption(add, 'Ranks shown as', 'Levels (no belt)');
  await expect(add.getByRole('combobox', { name: 'Ranks shown as', exact: true }).locator('[data-shown="true"]')).toHaveText('Levels (no belt)');
  await page.keyboard.press('Escape');
  await expect(add).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(add).toBeVisible();
  await add.getByRole('button', { name: 'Cancel' }).click();
  await expect(add).toHaveCount(0);
  expect(await db.discipline.count({ where: { schoolId: s.schoolId } })).toBe(1);

  // Edit discipline: the Adult program is a new drop-down too (no other style to pick, so only "None").
  await page.getByRole('region', { name: 'Style', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit discipline' });
  await expect(edit.locator('select')).toHaveCount(0);
  await expect(edit.getByRole('combobox')).toHaveCount(2);
  await expect(band(edit)).toHaveText(['Cancel', 'Save']);
  await edit.getByRole('button', { name: 'Cancel' }).click();

  // Start from template: each template an option card, still a radio; Create waits for a pick.
  await page.getByRole('button', { name: 'Start from template' }).click();
  const template = page.getByRole('dialog', { name: 'Start from a template' });
  await expect(template.locator('.u8gs-option')).toHaveCount(3);
  await expect(band(template)).toHaveText(['Cancel', 'Create style']);
  await expect(template.getByRole('button', { name: 'Create style' })).toBeDisabled();
  await template.getByRole('radio').first().check();
  await expect(template.getByRole('button', { name: 'Create style' })).toBeEnabled();
  await template.getByRole('button', { name: 'Cancel' }).click();
  await expect(template).toHaveCount(0);

  // Duplicate: its buttons in the band.
  await page.getByRole('region', { name: 'Style', exact: true }).getByRole('button', { name: 'Duplicate', exact: true }).click();
  const duplicate = page.getByRole('dialog', { name: 'Duplicate BJJ' });
  await expect(band(duplicate)).toHaveText(['Cancel', 'Duplicate']);
  await duplicate.getByRole('button', { name: 'Cancel' }).click();
  await expect(duplicate).toHaveCount(0);
  expect(await db.discipline.count({ where: { schoolId: s.schoolId } })).toBe(1);
});

test('a style\'s page and the belt editor: new drop-downs, round selectors, the band, and a pick counts as an edit', async ({ page }) => {
  await page.goto(`/disciplines/${s.disciplineId}`);
  await expectGradingHeader(page, 'Disciplines', 'Styles & Belts');
  await expect(page.getByRole('heading', { level: 2, name: 'Students', exact: true })).toBeVisible();

  // Add rank: "Where it goes" and "Which classes count" are the new drop-downs.
  await page.getByRole('button', { name: 'Add rank' }).click();
  const add = page.getByRole('dialog', { name: 'Add rank' });
  await expect(add.locator('select')).toHaveCount(0);
  await expect(band(add)).toHaveText(['Cancel', 'Save']);
  await expect(add.getByRole('combobox', { name: 'Where it goes in the ladder', exact: true }).locator('[data-shown="true"]')).toHaveText('Last, after Blue');
  await pickOption(add, 'Which classes count', 'A number for each ticked class type');
  // The pick counts as an edit: Escape and a click outside keep the editor open.
  await page.keyboard.press('Escape');
  await expect(add).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(add).toBeVisible();
  await add.getByRole('button', { name: 'Cancel' }).click();
  await expect(add).toHaveCount(0);
  expect(await db.rank.count({ where: { disciplineId: s.disciplineId } })).toBe(2);

  // Edit: stripe colour groups are round selectors, still radios.
  await page.getByRole('button', { name: 'Edit Blue' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Blue' });
  await edit.getByRole('button', { name: 'Add stripes' }).click();
  await expect(edit.getByRole('radio', { name: 'Colour 1 · 1 stripe' })).toHaveClass(/u8gs-radio/);
  await expect(edit.getByRole('radio', { name: 'Colour 1 · 1 stripe' })).toBeChecked();
  await edit.getByRole('button', { name: 'Cancel' }).click();
  await expect(edit).toHaveCount(0);

  // Reorder belts?: Back first, then Save order.
  await page.getByRole('button', { name: 'Move Blue up' }).click();
  await page.getByRole('button', { name: 'Save order' }).click();
  const reorder = page.getByRole('dialog', { name: 'Reorder belts?' });
  await expect(reorder.getByText('Sam Lee')).toBeVisible();
  await expect(band(reorder)).toHaveText(['Back', 'Save order']);
  await reorder.getByRole('button', { name: 'Back' }).click();
  await expect(reorder).toHaveCount(0);
  expect((await db.rank.findMany({ where: { disciplineId: s.disciplineId }, orderBy: { order: 'asc' } })).map((r) => r.name)).toEqual(['White', 'Blue']);
});

test('Grading → Skills: the new header, the style switch, and the skill dialog\'s band', async ({ page }) => {
  await page.goto('/grading/skills');
  await expectGradingHeader(page, 'Skills', 'Skills');
  await expect(page.getByRole('group', { name: 'Style', exact: true }).getByRole('button', { name: 'BJJ', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Add skill' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add skill' });
  await expect(band(dialog)).toHaveText(['Cancel', 'Save']);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('on a phone the pages and the belt editor fit the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/disciplines');
  await expect(page.getByText('BJJ', { exact: true }).first()).toBeVisible();
  expect(await fitsTheScreen(page)).toBe(true);

  await page.goto(`/disciplines/${s.disciplineId}`);
  await expect(page.getByRole('list', { name: 'Ladder' })).toBeVisible();
  expect(await fitsTheScreen(page)).toBe(true);
  // The six row buttons sit three per row.
  const actions = page.getByRole('listitem', { name: '1. White' }).locator('.u8gs-rung__actions');
  const tops = await actions.getByRole('button').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(2);

  await page.getByRole('button', { name: 'Edit Blue' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Blue' });
  await expect(edit.locator('.ultm8-modal__actions')).toBeInViewport();
  expect(await fitsTheScreen(page)).toBe(true);
  // The white card grows with the editor: nothing spills past it onto the dimmed page.
  expect(await edit.evaluate((el) => el.getBoundingClientRect().height >= el.scrollHeight - 1)).toBe(true);

  await page.goto('/grading/skills');
  await expect(page.getByRole('group', { name: 'Style', exact: true })).toBeVisible();
  expect(await fitsTheScreen(page)).toBe(true);
});
