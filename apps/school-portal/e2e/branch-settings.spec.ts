import { expect, test } from '@playwright/test';
import { addBranch, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 231 — Branch field-level settings screen: a dedicated page
 * (BranchSettingsPage.tsx) replacing the previous edit-via-modal path.
 * Covers the four new fields (`type`/`activities`/`facilities`/
 * `defaultLanguage`) round-tripping through the real screen, plus the
 * navigation change itself (BranchesPage's row action now goes to
 * `/branches/:id` instead of opening a Modal).
 */
let s: GradingSchool;
let branchId: string;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  const branch = await addBranch(s, 'Downtown Branch');
  branchId = branch.id;
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  await db.branch.deleteMany({ where: { id: branchId } });
});

test.afterAll(async () => {
  await cleanup();
});

test('clicking Settings on a Branch row navigates to the dedicated settings screen, not a modal', async ({ page }) => {
  await page.goto('/branches');
  await expect(page.getByRole('cell', { name: 'Downtown Branch' })).toBeVisible();

  await page.getByRole('row', { name: /Downtown Branch/ }).getByRole('button', { name: 'Settings' }).click();

  await expect(page).toHaveURL(new RegExp(`/branches/${branchId}$`));
  await expect(page.getByRole('heading', { name: 'Downtown Branch' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('fills in and saves the Decision 231 fields, then they survive a reload', async ({ page }) => {
  await page.goto(`/branches/${branchId}`);
  await expect(page.getByLabel('Branch name')).toHaveValue('Downtown Branch');

  await page.getByLabel('Type').fill('Dojo');
  await page.getByLabel('Activities').fill('BJJ, Judo');
  await page.getByLabel('Facilities').fill('Mats, Showers');
  await page.getByLabel('Default language').fill('en-GB');
  await page.getByLabel('Description').fill('Our flagship location.');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Branch settings saved.')).toBeVisible();

  const updated = await db.branch.findUniqueOrThrow({ where: { id: branchId } });
  expect(updated.type).toBe('Dojo');
  expect(updated.activities).toEqual(['BJJ', 'Judo']);
  expect(updated.facilities).toEqual(['Mats', 'Showers']);
  expect(updated.defaultLanguage).toBe('en-GB');
  expect(updated.description).toBe('Our flagship location.');

  await page.reload();
  await expect(page.getByLabel('Type')).toHaveValue('Dojo');
  await expect(page.getByLabel('Activities')).toHaveValue('BJJ, Judo');
  await expect(page.getByLabel('Facilities')).toHaveValue('Mats, Showers');
  await expect(page.getByLabel('Default language')).toHaveValue('en-GB');
  await expect(page.getByLabel('Description')).toHaveValue('Our flagship location.');
});
