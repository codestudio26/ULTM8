import { expect, test } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 381: on the Staff page an owner sets the School's own display name
 * and work phone for someone. The list shows them, with the person's own
 * account name and phone underneath; the account itself never changes.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterAll(async () => {
  await cleanup();
});

type Page = import('@playwright/test').Page;
const listCard = (page: Page) => page.locator('.ultm8-card').filter({ hasText: 'Your staff' });
const listRow = (page: Page, name: string) => listCard(page).getByRole('row').filter({ hasText: name });

test('an owner sets and clears a display name and work phone', async ({ page }) => {
  const kai = await addPerson('Kai', 'Lennox', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  const account = await db.user.findUniqueOrThrow({ where: { id: kai.id } });
  await signIn(page, s.ownerToken);
  await page.goto('/staff');

  await listRow(page, 'Kai Lennox').getByRole('button', { name: 'Actions for Kai Lennox' }).click();
  await page.getByRole('menuitem', { name: 'Edit details' }).click();
  const dialog = page.getByRole('dialog', { name: 'Details at this School: Kai Lennox' });
  await dialog.getByLabel('Display name').fill('Coach Kai');
  // The browser's locale (en-US) picks the country.
  await dialog.getByLabel('Work phone').fill('415 555 2671');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Details saved for Coach Kai.')).toBeVisible();

  const row = listRow(page, 'Coach Kai');
  await expect(row.getByText('Account name: Kai Lennox')).toBeVisible();
  await expect(row.getByText('+14155552671')).toBeVisible();
  await expect(row.getByText(account.phone!)).toBeVisible();
  // Search finds them by the display name.
  await listCard(page).getByLabel('Search').fill('coach kai');
  await expect(listRow(page, 'Coach Kai')).toHaveCount(1);
  await listCard(page).getByLabel('Search').fill('');

  const saved = await db.staffPermission.findFirstOrThrow({ where: { schoolId: s.schoolId, userId: kai.id } });
  expect(saved).toMatchObject({ displayName: 'Coach Kai', workPhone: '+14155552671' });
  const after = await db.user.findUniqueOrThrow({ where: { id: kai.id } });
  expect(after).toMatchObject({ firstName: 'Kai', surname: 'Lennox', phone: account.phone });

  // Clearing both shows the account's own name and phone again.
  await listRow(page, 'Coach Kai').getByRole('button', { name: 'Actions for Coach Kai' }).click();
  await page.getByRole('menuitem', { name: 'Edit details' }).click();
  await dialog.getByLabel('Display name').fill('');
  await dialog.getByLabel('Work phone').fill('');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(listRow(page, 'Kai Lennox').getByText('Account name:')).toHaveCount(0);
  expect(await db.staffPermission.findFirstOrThrow({ where: { schoolId: s.schoolId, userId: kai.id } })).toMatchObject({
    displayName: null,
    workPhone: null,
  });
});
