import { expect, test, type Page } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The New Portal belt editor (DESIGN.md → "Belt editor: one grade at a
 * time"): grade pills, a new stripe grade copying the previous one's numbers,
 * where a new rank goes in the ladder, Duplicate, stripe colour groups, the
 * "Ready to save" warning and a price per grade while the promotion fee is on.
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

const ladder = (page: Page) => page.getByRole('list', { name: 'Ladder' });
const beltOrder = async () => (await db.rank.findMany({ where: { disciplineId: s.disciplineId }, orderBy: { order: 'asc' }, select: { name: true } })).map((r) => r.name);
const rungsOf = async (name: string) =>
  db.rankStripeTier.findMany({ where: { rank: { disciplineId: s.disciplineId, name } }, orderBy: { order: 'asc' } });

test('a new stripe grade copies the previous grade\'s numbers, and is picked to edit', async ({ page }) => {
  await page.goto(`/disciplines/${s.disciplineId}`);
  await page.getByRole('button', { name: 'Edit Blue' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Blue' });
  await dialog.getByLabel('Classes required').fill('30');
  await dialog.getByRole('button', { name: '+ Add stripe grade' }).click();
  await expect(dialog.getByText('Grade 2 of 2')).toBeVisible();
  await expect(dialog.getByLabel('Classes required')).toHaveValue('30');
  await expect(dialog.getByRole('button', { name: 'Edit Blue · 1 Stripe' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  const [b0, b1] = await rungsOf('Blue');
  expect(b0.classesRequired).toBe(30);
  expect(b1).toMatchObject({ count: 1, classesRequired: 30, name: 'Blue · 1 Stripe' });
});

test('Add rank asks where it goes, and saves it there', async ({ page }) => {
  await page.goto(`/disciplines/${s.disciplineId}`);
  await page.getByRole('button', { name: 'Add rank' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add rank' });
  await dialog.getByLabel('Rank name').fill('Grey');
  await dialog.getByLabel('Where it goes in the ladder').selectOption({ label: 'After White' });
  await expect(dialog.getByText('Belt 2 of 3')).toBeVisible();
  await dialog.getByLabel('Classes required').fill('10');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await beltOrder()).toEqual(['White', 'Grey', 'Blue']);
  await expect(ladder(page).getByRole('listitem', { name: '2. Grey' })).toBeVisible();
});

test('Duplicate copies every grade, with no students, right after the original', async ({ page }) => {
  await page.goto(`/disciplines/${s.disciplineId}`);
  await page.getByRole('button', { name: 'Duplicate White' }).click();
  const dialog = page.getByRole('dialog', { name: 'Duplicate White' });
  await expect(dialog.getByText('Give it a new name and colour, then save.')).toBeVisible();
  await expect(dialog.getByLabel('Rank name')).toHaveValue('White (copy)');
  await expect(dialog.getByLabel('Where it goes in the ladder')).toHaveValue('1');
  await dialog.getByLabel('Rank name').fill('Grey');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await beltOrder()).toEqual(['White', 'Grey', 'Blue']);
  const white = await rungsOf('White');
  const grey = await rungsOf('Grey');
  expect(grey.map((r) => r.classesRequired)).toEqual(white.map((r) => r.classesRequired));
  expect(grey.map((r) => r.count)).toEqual(white.map((r) => r.count));
});

test('stripe colour groups: one Remove names the picked group', async ({ page }) => {
  await page.goto(`/disciplines/${s.disciplineId}`);
  await page.getByRole('button', { name: 'Edit Blue' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Blue' });
  await dialog.getByRole('button', { name: 'Add stripes' }).click();
  await dialog.getByRole('button', { name: 'Add stripes of another colour' }).click();
  await expect(dialog.getByRole('radio', { name: 'Colour 2 · 1 stripe' })).toBeChecked();
  await dialog.getByRole('radio', { name: 'Colour 1 · 1 stripe' }).check();
  await dialog.getByRole('button', { name: 'Remove colour 1' }).click();
  await expect(dialog.getByRole('radio')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
});

test('a grade that says nothing is a warning in "Ready to save", not a block', async ({ page }) => {
  await page.goto(`/disciplines/${s.disciplineId}`);
  await page.getByRole('button', { name: 'Add rank' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add rank' });
  await dialog.getByLabel('Rank name').fill('Purple');
  await expect(dialog.getByText('Check what it takes: Plain belt (0 classes and 0 days)')).toBeVisible();
  await dialog.getByLabel('Classes required').fill('5');
  await expect(dialog.getByText('Every grade says what it takes')).toBeVisible();
});

test('with the promotion fee on, the owner sets a price per grade', async ({ page }) => {
  await db.school.update({ where: { id: s.schoolId }, data: { promotionFeeEnabled: true, defaultCurrency: 'GBP' } });
  await page.goto(`/disciplines/${s.disciplineId}`);
  await page.getByRole('button', { name: 'Edit Blue' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Blue' });
  await dialog.getByLabel('Price for this grade').fill('40');
  await expect(dialog.getByText(/Priced grades of this rank: Blue 0: 40\.00/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  const [b0] = await rungsOf('Blue');
  expect(b0.promotionFeeMinor).toBe(4000);
});

test('with the fee off there is no price field at all', async ({ page }) => {
  await page.goto(`/disciplines/${s.disciplineId}`);
  await page.getByRole('button', { name: 'Edit Blue' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Blue' });
  await expect(dialog.getByLabel('Rank name')).toBeVisible();
  await expect(dialog.getByLabel('Price for this grade')).toHaveCount(0);
});
