import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';
import { messages as ptBR } from '../src/i18n/messages/pt-BR';
import { serverMessages as ptBRServer } from '../src/i18n/server/pt-BR';

/**
 * Decision 273 — the portal's language picker switches its text, and a
 * Platform Admin Translation row overrides the built-in wording.
 */

let s: GradingSchool;
const translationIds: string[] = [];
const notificationIds: string[] = [];

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterEach(async () => {
  await db.translation.deleteMany({ where: { id: { in: translationIds } } });
  translationIds.length = 0;
  await db.notification.deleteMany({ where: { id: { in: notificationIds } } });
  notificationIds.length = 0;
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

test("a job-written notification is shown in the picked language; a School's broadcast stays as written", async ({ page }) => {
  await db.user.update({ where: { id: s.ownerId }, data: { language: 'pt-BR' } });
  const job = await db.notification.create({
    data: {
      id: randomUUID(), userId: s.ownerId, type: 'WAITLIST_SPOT_OPENED', title: 'A spot opened up',
      body: "A spot opened up in Kids Judo. Claim it soon — it goes to the next person on the waitlist if you don't.",
    },
  });
  const broadcast = await db.notification.create({
    data: { id: randomUUID(), userId: s.ownerId, type: 'SCHOOL_BROADCAST', title: 'A spot opened up', body: 'Gym closed Friday.' },
  });
  notificationIds.push(job.id, broadcast.id);
  await signIn(page, s.ownerToken);
  await page.goto('/notifications');

  const expectedTitle = ptBR.server!.notifications!.spotOpenedTitle!;
  const expectedBody = ptBR.server!.notifications!.spotOpenedBody!.replace('{class}', 'Kids Judo');
  await expect(page.getByRole('cell', { name: expectedTitle, exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: expectedBody, exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'A spot opened up', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Gym closed Friday.', exact: true })).toBeVisible();
});

test("the API's error messages are shown in the picked language, and an untranslated one is never shown in English", async ({ page }) => {
  await db.user.update({ where: { id: s.ownerId }, data: { language: 'pt-BR' } });
  await signIn(page, s.ownerToken);
  let reply = { status: 409, message: 'An account with this email, phone, or username already exists' };
  await page.route('**/v1/schools/*', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST', message: reply.message } }) })
      : route.fallback(),
  );
  await page.goto('/school');
  const save = page.getByRole('button', { name: ptBR.schools!.profile!.saveChanges! }).first();

  await save.click();
  await expect(page.getByText(ptBRServer['An account with this email, phone, or username already exists']!)).toBeVisible();

  reply = { status: 400, message: 'A message nobody has translated yet.' };
  await save.click();
  await expect(page.getByText(ptBR.server!.generic!.badRequest!)).toBeVisible();
  await expect(page.getByText('A message nobody has translated yet.')).toHaveCount(0);
});
