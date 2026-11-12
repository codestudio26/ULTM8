import { expect, test, type Locator, type Page } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The shared address fields in the new look (Decision 460): Country is a
 * searchable picker like Currency, and a Region from a fixed list is the new
 * look's drop-down; no browser <select> is left. The same stored values
 * (country codes, region codes), the same checks, and a pick still counts as
 * an edit in a dialog. Covered on Edit a student and the Add branch dialog.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

const address = (scope: Page | Locator) => scope.locator('fieldset.ultm8-address');
const countryBox = (scope: Page | Locator) => scope.getByRole('combobox', { name: 'Country', exact: true });
const countryList = (scope: Page | Locator) => scope.getByRole('listbox');

test('Edit a student: typing filters the countries, and a keyboard pick saves the same country code', async ({ page }) => {
  await page.goto(`/students/${s.newStudent.id}/edit`);
  await expect(address(page).locator('select')).toHaveCount(0);

  const country = countryBox(page);
  await country.click();
  const list = countryList(page);
  await expect(list.getByRole('option').first()).toHaveText('Select a country');
  expect(await list.getByRole('option').count()).toBeGreaterThan(200);

  await country.fill('zeal');
  await expect(list.getByRole('option')).toHaveText(['New Zealand']);
  await country.fill('gb');
  await expect(list.getByRole('option')).toHaveText(['United Kingdom']);
  await country.fill('qqqq');
  await expect(list.getByRole('option')).toHaveCount(0);
  await expect(list.getByText('No matches.')).toBeVisible();

  // Escape closes the list and keeps the country it had.
  await country.fill('japan');
  await country.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(country).not.toHaveValue('Japan');

  await country.click();
  await country.fill('united king');
  await country.press('ArrowDown');
  await country.press('Enter');
  await expect(country).toHaveValue('United Kingdom');
  await expect(list).toHaveCount(0);

  await page.getByLabel('Address line 1').fill('221B Dojo Lane');
  await page.getByLabel('Town/City').fill('London');
  await page.getByLabel('Postcode').fill('nw1 6xe');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();

  const user = await db.user.findUniqueOrThrow({ where: { id: s.newStudent.id } });
  expect(user.addressCountry).toBe('GB');
  expect(user.addressPostalCode).toBe('NW1 6XE');
  expect(user.address).toBe('221B Dojo Lane, London, NW1 6XE, United Kingdom');
});

test("Edit a student: a State is the new look's drop-down, still required, and saves its code", async ({ page }) => {
  await page.goto(`/students/${s.newStudent.id}/edit`);
  const country = countryBox(page);
  await country.click();
  await country.fill('united states');
  await countryList(page).getByRole('option', { name: 'United States', exact: true }).click();
  await expect(country).toHaveValue('United States');

  const state = page.getByRole('combobox', { name: 'State', exact: true });
  await expect(state.locator('[data-shown="true"]')).toHaveText('Select…');
  await page.getByLabel('Address line 1').fill('1 Congress Ave');
  await page.getByLabel('City', { exact: true }).fill('Austin');
  await page.getByLabel('ZIP code').fill('78701');
  // The same check as before: a US address needs its State.
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('State is required.')).toBeVisible();
  await expect(state).toHaveAttribute('aria-invalid', 'true');

  await state.click();
  await page.getByRole('listbox', { name: 'State' }).getByRole('option', { name: 'Texas', exact: true }).click();
  await expect(state.locator('[data-shown="true"]')).toHaveText('Texas');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();

  const user = await db.user.findUniqueOrThrow({ where: { id: s.newStudent.id } });
  expect(user.addressCountry).toBe('US');
  expect(user.addressRegion).toBe('TX');
});

test('Add branch: a country or region pick counts as an edit, and the branch saves the picked country', async ({ page }) => {
  // The dialog starts an empty address on the School's own country.
  await db.school.update({ where: { id: s.schoolId }, data: { addressCountry: 'US' } });
  await page.goto('/branches');
  const open = async () => {
    await page.getByRole('button', { name: 'Add branch' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add branch' });
    await expect(dialog).toBeVisible();
    await expect(countryBox(dialog)).toHaveValue('United States');
    return dialog;
  };

  // Untouched, a click outside closes it, as before.
  let dialog = await open();
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);

  // A region pick alone is an edit.
  dialog = await open();
  await expect(address(dialog).locator('select')).toHaveCount(0);
  await dialog.getByRole('combobox', { name: 'State', exact: true }).click();
  await dialog.getByRole('listbox', { name: 'State' }).getByRole('option', { name: 'Ohio', exact: true }).click();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  // So is a country pick with the mouse, nothing typed; Escape in the open list only closes the list.
  dialog = await open();
  const country = countryBox(dialog);
  await country.click();
  await country.press('Escape');
  await expect(countryList(dialog)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await country.click();
  await countryList(dialog).getByRole('option', { name: 'Canada', exact: true }).click();
  await expect(country).toHaveValue('Canada');
  await page.mouse.click(5, 5);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();

  await country.click();
  await country.fill('ireland');
  await countryList(dialog).getByRole('option', { name: 'Ireland', exact: true }).click();
  await expect(country).toHaveValue('Ireland');

  await dialog.getByLabel('Branch name').fill('Dublin Dojo');
  await dialog.getByLabel('Address line 1').fill('1 Grafton Street');
  await dialog.getByLabel('Town', { exact: true }).fill('Dublin');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  const branch = await db.branch.findFirstOrThrow({ where: { schoolId: s.schoolId, name: 'Dublin Dojo' } });
  expect(branch.addressCountry).toBe('IE');
  expect(branch.addressCity).toBe('Dublin');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the open country list and the State drop-down fit the screen', async ({ page }) => {
    await page.goto(`/students/${s.newStudent.id}/edit`);
    const country = countryBox(page);
    await country.click();
    await country.fill('united');
    const list = countryList(page);
    await expect(list.getByRole('option', { name: 'United States', exact: true })).toBeVisible();
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(await fits()).toBe(true);
    const box = (await list.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await list.getByRole('option', { name: 'United States', exact: true }).click();

    const state = page.getByRole('combobox', { name: 'State', exact: true });
    await state.click();
    await expect(page.getByRole('listbox', { name: 'State' })).toBeVisible();
    expect(await fits()).toBe(true);
    const field = (await state.boundingBox())!;
    expect(field.x + field.width).toBeLessThanOrEqual(390);
  });
});
