import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 273 — the portal's language picker switches its text, and a
 * Platform Admin Translation row overrides the built-in wording.
 */

let s: GradingSchool;
const translationIds: string[] = [];

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterEach(async () => {
  await db.translation.deleteMany({ where: { id: { in: translationIds } } });
  translationIds.length = 0;
});

test.afterAll(async () => {
  await cleanup();
});

test('picking Portuguese in the header translates the menu and the page', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();

  await page.getByRole('combobox', { name: 'Language' }).selectOption('pt-BR');

  await expect(page.getByRole('heading', { name: 'Notificações' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Alunos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
  // Saved to the profile, so it survives a reload.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Notificações' })).toBeVisible();
});

test('Arabic switches the page to right-to-left', async ({ page }) => {
  await db.user.update({ where: { id: s.ownerId }, data: { language: 'ar' } });
  await signIn(page, s.ownerToken);
  await page.goto('/notifications');

  await expect(page.getByRole('heading', { name: 'الإشعارات' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
});

test('a Platform Admin Translation row replaces the built-in text', async ({ page }) => {
  await db.user.update({ where: { id: s.ownerId }, data: { language: 'es' } });
  const row = await db.translation.create({
    data: { id: randomUUID(), screen: 'notifications', labelKey: 'title', locale: 'es', content: 'Avisos' },
  });
  translationIds.push(row.id);
  await signIn(page, s.ownerToken);
  await page.goto('/notifications');

  await expect(page.getByRole('heading', { name: 'Avisos' })).toBeVisible();
  // Keys without a row keep the built-in Spanish.
  await expect(page.getByText('Novedades enviadas a tu cuenta.')).toBeVisible();
});
