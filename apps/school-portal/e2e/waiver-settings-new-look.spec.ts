import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Waiver settings in the new look (Decision 453). The approved design draws
 * no waiver settings screen, so the page keeps its layout and is restyled
 * only: the white page header with "‹ Back to waivers", every setting in one
 * white card with Save changes / Discard as an equal button pair under them,
 * and the retention rule in its own card. Nothing scrolls sideways on a phone.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

const SETTINGS = [
  'Signatures on archived waivers still count',
  'Members sign again after a set time',
  'A child signs again at 18',
  'Children sign their own waivers from a set age',
  'Record waivers signed on paper',
  'Tell new members which waivers to sign',
  "Remind members until they've signed",
];

test('the page keeps every setting in the new look; Save changes and Discard are an equal pair', async ({ page }) => {
  await page.goto('/waivers/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Waiver settings' })).toBeVisible();
  await expect(page.locator('.u8n-page-header')).toBeVisible();
  await expect(page.getByRole('link', { name: /Back to waivers/ })).toHaveAttribute('href', '/waivers');

  const card = page.getByRole('region', { name: 'Waiver settings' });
  for (const name of SETTINGS) await expect(card.getByRole('switch', { name })).toBeVisible();

  const save = card.getByRole('button', { name: 'Save changes' });
  const discard = card.getByRole('button', { name: 'Discard' });
  await expect(save).toBeDisabled();
  await expect(discard).toBeDisabled();
  const a = await save.boundingBox();
  const b = await discard.boundingBox();
  expect(Math.round(a!.width)).toBe(Math.round(b!.width));
  expect(Math.round(a!.height)).toBe(Math.round(b!.height));
  expect(Math.round(a!.y)).toBe(Math.round(b!.y));

  // A change makes both buttons usable; Discard puts it back.
  const paper = card.getByRole('switch', { name: 'Record waivers signed on paper' });
  const before = await paper.getAttribute('aria-checked');
  await paper.click();
  await expect(save).toBeEnabled();
  await discard.click();
  await expect(paper).toHaveAttribute('aria-checked', before!);
  await expect(save).toBeDisabled();

  await expect(page.getByRole('heading', { name: 'How long signed waivers are kept' })).toBeVisible();
});

test('a number out of range is marked on its field and blocks saving; a good one saves', async ({ page }) => {
  await page.goto('/waivers/settings');
  await page.getByRole('switch', { name: "Remind members until they've signed" }).click();
  const days = page.getByLabel('Days between reminders');
  await expect(days).toHaveValue('7');
  await days.fill('120');
  await expect(days).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Enter a whole number of days from 1 to 90.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await days.fill('14');
  await expect(days).not.toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status').getByText('Waiver settings saved.')).toBeVisible();
  expect((await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).waiverReminderDays).toBe(14);
  await db.school.update({ where: { id: s.schoolId }, data: { waiverReminderDays: null } });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('every setting is there and nothing scrolls sideways', async ({ page }) => {
    await page.goto('/waivers/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Waiver settings' })).toBeVisible();
    await page.getByRole('switch', { name: 'Members sign again after a set time' }).click();
    for (const name of SETTINGS) await expect(page.getByRole('switch', { name })).toBeVisible();
    await expect(page.getByLabel('Months')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
