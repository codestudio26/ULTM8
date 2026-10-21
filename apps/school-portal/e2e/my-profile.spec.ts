import { expect, test, type Page } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The header's account menu (the avatar block as a menu button) and the
 * My profile page behind it — the signed-in user's own GET/PATCH /users/me.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // owner: Olive Owner
});

test.afterAll(async () => {
  await cleanup();
});

/** The header's avatar block — its accessible name is the user's name and role. */
function accountButton(page: Page, name = 'Olive Owner') {
  return page.getByRole('button', { name });
}

test('the avatar opens a menu with name, email, role and the account links; Escape closes it', async ({ page }) => {
  const owner = await db.user.findUniqueOrThrow({ where: { id: s.ownerId } });
  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');

  const trigger = accountButton(page);
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('menu')).toHaveCount(0);

  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Account' });
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByText(owner.email)).toBeVisible();
  await expect(menu.getByText('School Owner')).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText(['My profile', 'School settings', 'Log out']);
  // Keyboard: focus starts on the first item and the arrow keys move it.
  await expect(menu.getByRole('menuitem', { name: 'My profile' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'School settings' })).toBeFocused();
  // The sidebar's Log out button is still the only "Log out" button.
  await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();

  // A click outside closes it too.
  await trigger.click();
  await expect(menu).toBeVisible();
  await page.getByRole('heading', { name: 'Dashboard' }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('My profile: change the first name and save; email and phone are read-only', async ({ page }) => {
  const owner = await db.user.findUniqueOrThrow({ where: { id: s.ownerId } });
  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');

  await accountButton(page).click();
  await page.getByRole('menuitem', { name: 'My profile' }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible();

  const email = page.getByLabel('Email', { exact: true });
  const phone = page.getByLabel('Phone', { exact: true });
  await expect(email).toHaveValue(owner.email);
  await expect(phone).toHaveValue(owner.phone);
  await expect(email).not.toBeEditable();
  await expect(phone).not.toBeEditable();
  await expect(page.getByText("You sign in with your email and phone number, so they can't be changed here.")).toBeVisible();

  await expect(page.getByLabel('First name')).toHaveValue('Olive');
  await page.getByLabel('First name').fill('Olivia');
  await page.getByLabel('Address').fill('1 Mat Street');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByText('Saved.')).toBeVisible();
  const saved = await db.user.findUniqueOrThrow({ where: { id: s.ownerId } });
  expect(saved.firstName).toBe('Olivia');
  expect(saved.address).toBe('1 Mat Street');
  expect(saved.email).toBe(owner.email);
  expect(saved.phone).toBe(owner.phone);
  // The header follows the saved name.
  await expect(accountButton(page, 'Olivia Owner')).toBeVisible();
});

test('saving a language on My profile switches the portal like the header picker', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/profile');
  await page.locator('#profile-language').selectOption('pt-BR');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByRole('heading', { name: 'Meu perfil' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
  const saved = await db.user.findUniqueOrThrow({ where: { id: s.ownerId } });
  expect(saved.language).toBe('pt-BR');
});

test("a coach's menu has no School settings, and My profile works for them too", async ({ page }) => {
  const coach = await addPerson('Cody', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await signIn(page, coach.token);
  await page.goto('/coach');

  await accountButton(page, 'Cody Coach').click();
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['My profile', 'Log out']);
  await page.getByRole('menuitem', { name: 'My profile' }).click();
  await page.getByLabel('Surname').fill('Coachman');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByText('Saved.')).toBeVisible();
  expect((await db.user.findUniqueOrThrow({ where: { id: coach.id } })).surname).toBe('Coachman');
});

test('Log out in the menu signs out', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');
  await accountButton(page).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();

  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(() => sessionStorage.getItem('ultm8.accessToken'))).toBeNull();
});
