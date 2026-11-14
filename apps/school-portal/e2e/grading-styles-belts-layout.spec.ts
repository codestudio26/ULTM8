import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Grading → Styles & Belts in the design's layout (Decision 462 item 9): a
 * style switch in place of the table of styles, one style at a time; an
 * "About this style" panel; and a panel for the picked belt. Every action
 * the page had is still there, and nothing is shown twice.
 *
 * Seed: BJJ (White 0–2, Blue 0; Armbar needed for White 2; Sam Lee on
 * White 1) plus Judo with no belts.
 */
let s: GradingSchool;
let judoId: string;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  judoId = (await db.discipline.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'Judo', classTypesOffered: ['Randori'] } })).id;
  await db.discipline.update({ where: { id: s.disciplineId }, data: { classTypesOffered: ['Fundamentals'] } });
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

const styleCard = (page: Page) => page.getByRole('region', { name: 'Style', exact: true });
const styleSwitch = (page: Page) => page.getByRole('group', { name: 'Style', exact: true });
const about = (page: Page) => page.getByRole('region', { name: 'About this style' });
const ladder = (page: Page) => page.getByRole('list', { name: 'Ladder' });

async function fitsTheScreen(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

test('one style at a time, picked with the style switch; no table of styles', async ({ page }) => {
  await page.goto('/disciplines');
  await expect(page.getByRole('table')).toHaveCount(1); // the Students card only
  await expect(page.getByRole('row', { name: /^(BJJ|Judo)\b/ })).toHaveCount(0);
  await expect(styleSwitch(page).getByRole('button')).toHaveText(['BJJ', 'Judo']);
  await expect(styleSwitch(page).getByRole('button', { name: 'BJJ' })).toHaveAttribute('aria-pressed', 'true');
  await expect(ladder(page).getByRole('listitem', { name: '2. Blue' })).toBeVisible();

  await styleSwitch(page).getByRole('button', { name: 'Judo' }).click();
  await expect(page).toHaveURL(new RegExp(`/disciplines/${judoId}$`));
  await expect(about(page).getByRole('heading', { name: 'Judo' })).toBeVisible();
  await expect(page.getByText('No ranks yet')).toBeVisible();
  await expect(ladder(page)).toHaveCount(0);

  // The address opens that style.
  await page.goto(`/disciplines/${s.disciplineId}`);
  await expect(styleSwitch(page).getByRole('button', { name: 'BJJ' })).toHaveAttribute('aria-pressed', 'true');
});

test('About this style shows what the page does not: counts, ranks shown as, class types, board columns', async ({ page }) => {
  await page.goto('/disciplines');
  const panel = about(page);
  await expect(panel.getByRole('heading', { name: 'BJJ' })).toBeVisible();
  const figure = (label: string) => panel.locator('.u8gs-stats > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd');
  await expect(figure('Belts')).toHaveText('2');
  await expect(figure('Grades')).toHaveText('4');
  await expect(figure('Students')).toHaveText('1');
  await expect(panel.getByText('Belts', { exact: true }).last()).toBeVisible(); // Ranks shown as: Belts
  await expect(panel.getByRole('listitem')).toHaveText(['Fundamentals']);
  await expect(panel.getByText('under 33%')).toBeVisible();
  await expect(panel.getByText('66%+')).toBeVisible();
  // Shown once: the class types are no longer under the page title, and the Students card's heading has no count.
  await expect(page.locator('.u8n-page-header').getByText('Fundamentals')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Students', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Students \(/ })).toHaveCount(0);
});

test('picking a belt shows its panel with what each grade takes; ✕ goes back to About this style', async ({ page }) => {
  await page.goto('/disciplines');
  await ladder(page).getByRole('button', { name: 'White', exact: true }).click();
  const belt = page.getByRole('region', { name: 'White', exact: true });
  await expect(belt).toBeVisible();
  await expect(about(page)).toHaveCount(0);
  await expect(belt.getByText('1 student', { exact: true })).toBeVisible();
  await expect(belt.getByRole('listitem')).toHaveCount(3);
  const white2 = belt.getByRole('listitem').filter({ hasText: 'White 2' });
  await expect(white2.getByText('Classes required: 3')).toBeVisible();
  await expect(white2.getByText('Required skills: Armbar')).toBeVisible();
  // Not repeated from the row: no Edit / Duplicate in the panel.
  await expect(belt.getByRole('button', { name: /Edit|Duplicate/ })).toHaveCount(0);
  await expect(ladder(page).getByRole('listitem', { name: '1. White' })).toHaveClass(/u8gs-rung--on/);

  // A click on the row picks it too; its buttons don't.
  await ladder(page).getByRole('listitem', { name: '2. Blue' }).locator('.u8gs-rung__grades').click();
  await expect(page.getByRole('region', { name: 'Blue', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit White' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit White' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Edit White' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('region', { name: 'Blue', exact: true })).toBeVisible();

  await page.getByRole('region', { name: 'Blue', exact: true }).getByRole('button', { name: 'Close' }).click();
  await expect(about(page)).toBeVisible();
});

test('every action the page had is still there', async ({ page }) => {
  await page.goto('/disciplines');
  await expect(styleCard(page).getByRole('button')).toHaveText(['BJJ', 'Judo', 'Edit', 'Duplicate', 'Archive', 'Delete', 'Start from template', 'Add discipline']);
  await expect(page.getByRole('button', { name: 'Add rank' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add skill' })).toBeVisible();
  const white = ladder(page).getByRole('listitem', { name: '1. White' });
  for (const name of ['Edit White', 'Duplicate White', 'Move White up', 'Move White down', 'Archive White', 'Delete White']) {
    await expect(white.getByRole('button', { name, exact: true })).toBeVisible();
  }
  const armbar = page.getByRole('list', { name: 'Skills' }).getByRole('listitem', { name: 'Armbar' });
  for (const name of ['Move Armbar up', 'Move Armbar down', 'Edit', 'Delete Armbar']) {
    await expect(armbar.getByRole('button', { name, exact: true })).toBeVisible();
  }
});

test('a coach sees the same layout read-only', async ({ page }) => {
  const coach = await addPerson('Cara', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await signIn(page, coach.token);
  await page.goto('/disciplines');
  await expect(styleCard(page).getByRole('button')).toHaveText(['BJJ', 'Judo']);
  await expect(page.getByText('Only the School owner can change this style.')).toBeVisible();
  await expect(about(page)).toBeVisible();
  await ladder(page).getByRole('button', { name: 'White', exact: true }).click();
  const belt = page.getByRole('region', { name: 'White', exact: true });
  await expect(belt).toBeVisible();
  await expect(belt.getByText(/student/)).toHaveCount(0); // student counts are the owner's
});

test('on a phone: fits the screen, the content first and the panel under it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/disciplines');
  await expect(about(page)).toBeVisible();
  expect(await fitsTheScreen(page)).toBe(true);
  const ladderBox = await ladder(page).boundingBox();
  const panelBox = await about(page).boundingBox();
  expect(panelBox!.y).toBeGreaterThan(ladderBox!.y);
  await ladder(page).getByRole('button', { name: 'White', exact: true }).click();
  await expect(page.getByRole('region', { name: 'White', exact: true })).toBeVisible();
  expect(await fitsTheScreen(page)).toBe(true);
});
