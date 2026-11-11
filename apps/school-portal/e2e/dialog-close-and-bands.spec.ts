import { expect, test, type Locator, type Page } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Every dialog's round ✕ (Decision 460), from the shared Modal, and the
 * button band (ModalActions, Cancel first) on the dialogs whose content was
 * already in the new look. Look only: the dialogs' own specs still cover
 * what each one saves.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

const closeButton = (dialog: Locator) => dialog.locator('.ultm8-modal__head').getByRole('button', { name: 'Close dialog' });
const band = (dialog: Locator) => dialog.locator('.ultm8-modal__actions').getByRole('button');

async function openExport(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  return page.getByRole('dialog', { name: 'Export students' });
}

test('the ✕ in the header closes an untouched dialog, like Escape and a click outside', async ({ page }) => {
  await page.goto('/students');
  let dialog = await openExport(page);
  await expect(closeButton(dialog)).toBeVisible();
  await closeButton(dialog).click();
  await expect(dialog).toHaveCount(0);

  dialog = await openExport(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('after an edit the ✕ does what Cancel does: Escape and a click outside still keep the form, the ✕ closes it unsaved', async ({ page }) => {
  await page.goto('/curriculum');
  await page.getByRole('button', { name: 'Add lesson' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add lesson' });
  await dialog.getByLabel('Title', { exact: true }).fill('Kimura from the ✕ test');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();

  await expect(band(dialog)).toHaveText(['Cancel', 'Save']);
  await closeButton(dialog).click();
  await expect(dialog).toHaveCount(0);
  expect(await db.lesson.count({ where: { schoolId: s.schoolId, title: 'Kimura from the ✕ test' } })).toBe(0);
});

test('already-new dialogs have their buttons in the band at the foot, Cancel first, with the same disabled states', async ({ page }) => {
  await page.goto('/waivers');
  await page.getByRole('button', { name: 'Add waiver' }).click();
  let dialog = page.getByRole('dialog', { name: 'Add waiver' });
  await expect(band(dialog)).toHaveText(['Cancel', 'Save']);
  // Save waits for a title and a text, as before.
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  await page.goto('/school');
  await page.getByRole('button', { name: 'Make a new code' }).click();
  dialog = page.getByRole('dialog', { name: 'Make a new join code?' });
  await expect(band(dialog)).toHaveText(['Cancel', 'Make a new code']);
  await closeButton(dialog).click();
  await expect(dialog).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the ✕ sits on the screen, at the right of the title', async ({ page }) => {
    await page.goto('/school');
    await page.getByRole('button', { name: 'Make a new code' }).click();
    const dialog = page.getByRole('dialog', { name: 'Make a new join code?' });
    const title = await dialog.getByRole('heading', { name: 'Make a new join code?' }).boundingBox();
    const close = await closeButton(dialog).boundingBox();
    expect(close!.x).toBeGreaterThan(title!.x);
    expect(close!.x + close!.width).toBeLessThanOrEqual(390);
    expect(close!.y).toBeGreaterThanOrEqual(0);
  });
});
