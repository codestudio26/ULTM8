import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { addCoach, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Grading → Settings and Grading → Permissions in the new look (Decision 453,
 * Decision 460 item 17; forms group 9c): the new page header with the Grading
 * tabs, white cards, the new look's drop-downs (no browser <select>) and
 * switches. Look only: grading-settings, grading-permissions and rank-levels
 * still cover what each page saves.
 *
 * Seed: BJJ, board 33% / 66%, ranks shown as Belts, promotion fee off.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterAll(async () => {
  await cleanup();
});

async function fitsTheScreen(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

/** The new header with the Grading tabs, the current one marked; no old header or tabs. */
async function expectGradingHeader(page: Page, title: string, current: string) {
  const header = page.locator('.u8n-page-header');
  await expect(header.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(header.getByRole('navigation', { name: 'Grading' }).getByRole('link', { name: current })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.ultm8-page-header')).toHaveCount(0);
  await expect(page.locator('.ultm8-tabs')).toHaveCount(0);
  await expect(page.locator('main select')).toHaveCount(0);
}

const unsavedBar = (page: Page) => page.getByRole('region', { name: 'You have unsaved changes.' });

test('Settings: the new header and tabs; a drop-down pick is an edit, Discard puts it back', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/grading/settings');
  await expectGradingHeader(page, 'Grading settings', 'Settings');
  await expect(page.getByRole('region', { name: 'About this setting' })).toBeVisible();

  // Ranks shown as: a Belts · Levels switch (Decision 462 item 10). Picking the chosen one changes nothing.
  const display = page.getByRole('group', { name: 'BJJ: ranks shown as' });
  const belts = display.getByRole('button', { name: 'Belts', exact: true });
  const levels = display.getByRole('button', { name: 'Levels (no belt)', exact: true });
  await expect(belts).toHaveAttribute('aria-pressed', 'true');
  await belts.click();
  await expect(unsavedBar(page)).toHaveCount(0);

  // A different pick is an edit: the bar shows, Cancel-first order Discard / Save changes.
  await levels.click();
  await expect(levels).toHaveAttribute('aria-pressed', 'true');
  const bar = unsavedBar(page);
  await expect(bar.getByRole('button')).toHaveText(['Discard', 'Save changes']);
  await bar.getByRole('button', { name: 'Discard' }).click();
  await expect(bar).toHaveCount(0);
  await expect(belts).toHaveAttribute('aria-pressed', 'true');

  // Promotion: also a drop-down; a pick moves About this setting, then Save sends it.
  const promotion = page.getByRole('combobox', { name: 'BJJ: promotion' });
  await promotion.click();
  await page.getByRole('option', { name: 'Automatically award stripes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Promotion', exact: true })).toBeVisible();
  await unsavedBar(page).getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(unsavedBar(page)).toHaveCount(0);
  await expect.poll(async () => (await db.discipline.findUniqueOrThrow({ where: { id: s.disciplineId } })).promotionMode).toBe('AUTO_STRIPES');
});

test('Settings: a wrong % keeps Save changes off; the bar stays in view while the page scrolls', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/grading/settings');
  await page.getByLabel('BJJ: "Getting There" from (%)').fill('80');
  const bar = unsavedBar(page);
  await expect(page.getByRole('alert')).toContainText('"Getting There" below "Ready to Grade"');
  await expect(bar.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(bar).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(bar).toBeInViewport();
  await bar.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByLabel('BJJ: "Getting There" from (%)')).toHaveValue('33');
  const style = await db.discipline.findUniqueOrThrow({ where: { id: s.disciplineId } });
  expect([style.boardGettingThere, style.boardReadyToGrade]).toEqual([33, 66]);
});

test('Settings on a phone: fits the screen, settings first and About this setting under them', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, s.ownerToken);
  await page.goto('/grading/settings');
  await expectGradingHeader(page, 'Grading settings', 'Settings');
  expect(await fitsTheScreen(page)).toBe(true);
  const firstCard = await page.getByRole('region', { name: 'How ranks are shown' }).boundingBox();
  const about = await page.getByRole('region', { name: 'About this setting' }).boundingBox();
  expect(firstCard && about && about.y > firstCard.y).toBe(true);

  await page.getByRole('switch', { name: 'Promotion fee' }).click();
  const bar = unsavedBar(page);
  await expect(bar).toBeInViewport();
  expect(await fitsTheScreen(page)).toBe(true);
  await bar.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('switch', { name: 'Promotion fee' })).toHaveAttribute('aria-checked', 'false');
});

test('Settings, a coach: the same new look, with only what the coach may change open', async ({ page }) => {
  const coach = await addPerson('Rita', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await db.gradingPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: coach.id, disciplineId: s.disciplineId } });
  await signIn(page, coach.token);
  await page.goto('/grading/settings');
  // A coach has no Permissions tab (Decision 184).
  const header = page.locator('.u8n-page-header');
  await expect(header.getByRole('navigation', { name: 'Grading' }).getByRole('link')).toHaveText(['Board', 'Styles & Belts', 'Skills', 'Settings']);
  await expect(page.locator('main select')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'BJJ: promotion' })).toBeDisabled();
  await expect(page.getByRole('switch', { name: 'Promotion fee' })).toBeDisabled();
  await expect(page.getByText('Only the School owner can change the promotion fee.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Grading permissions ›' })).toHaveCount(0);
});

test('Permissions: the new header and tabs; switches instead of a table, saved as before', async ({ page }) => {
  const carla = await addCoach(s, 'Carla', 'Reyes');
  await signIn(page, s.ownerToken);
  await page.goto('/grading/permissions');
  await expectGradingHeader(page, 'Grading permissions', 'Permissions');
  const card = page.getByRole('region', { name: carla.name });
  await expect(card.locator('table, input[type="checkbox"]')).toHaveCount(0);
  await expect(card.getByRole('switch')).toHaveCount(8);

  const may = card.getByRole('switch', { name: `${carla.name} may grade in BJJ` });
  const promote = card.getByRole('switch', { name: `${carla.name}, BJJ: Promote` });
  await expect(may).toHaveAttribute('aria-checked', 'false');
  await expect(promote).toBeDisabled();
  await card.getByText('May grade', { exact: true }).click(); // the label turns it on too
  await expect(may).toHaveAttribute('aria-checked', 'true');
  await expect(promote).toHaveAttribute('aria-checked', 'true');
  await promote.click();
  await expect(card.getByRole('button')).toHaveText(['Undo', 'Save']);
  await card.getByRole('button', { name: `Save permissions for ${carla.name}` }).click();
  await expect(card.getByText('Saved.')).toBeVisible();
  expect(await db.gradingPermission.findFirst({ where: { userId: carla.id, disciplineId: s.disciplineId } })).toMatchObject({ canPromote: false, canDowngrade: true });
});

test('Permissions on a phone: one list of switches that fits the screen', async ({ page }) => {
  const carla = await addCoach(s, 'Carla', 'Reyes');
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, s.ownerToken);
  await page.goto('/grading/permissions');
  const card = page.getByRole('region', { name: carla.name });
  await expect(card.getByRole('switch')).toHaveCount(8);
  expect(await fitsTheScreen(page)).toBe(true);
  const promote = await card.getByRole('switch', { name: `${carla.name}, BJJ: Promote` }).boundingBox();
  const moveDown = await card.getByRole('switch', { name: `${carla.name}, BJJ: Move down` }).boundingBox();
  expect(promote && moveDown && moveDown.y > promote.y && Math.abs(moveDown.x - promote.x) < 2).toBe(true);
});

test('Permissions, a co-owner: the same new look, locked, with no Save', async ({ page }) => {
  const carla = await addCoach(s, 'Carla', 'Reyes');
  const co = await addPerson('Cora', 'Owner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: s.schoolId }]);
  await signIn(page, co.token);
  await page.goto('/grading/permissions');
  await expectGradingHeader(page, 'Grading permissions', 'Permissions');
  const card = page.getByRole('region', { name: carla.name });
  await expect(card.getByRole('switch', { name: `${carla.name} may grade in BJJ` })).toBeDisabled();
  await expect(card.getByRole('button', { name: `Save permissions for ${carla.name}` })).toHaveCount(0);
});
