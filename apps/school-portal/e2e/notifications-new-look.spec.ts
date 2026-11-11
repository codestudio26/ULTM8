import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The Notifications page in the new look (Decision 453; DESIGN-BRIEF §8,
 * DESIGN.md → "Stat rows", "One accent: mint", "Phone layout"): the white page
 * header with the actions, the three number cards, the inbox as a card of
 * rows and the sent messages as a card; no right-hand panel (the page has no
 * selected-item view) and no old-look table, badge or button on the page.
 */
let s: GradingSchool;
const notificationIds: string[] = [];

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterEach(async () => {
  await db.notification.deleteMany({ where: { id: { in: notificationIds } } });
  notificationIds.length = 0;
  await db.notificationBroadcast.deleteMany({ where: { schoolId: s.schoolId } });
});

test.afterAll(async () => {
  await cleanup();
});

const inbox = (page: Page) => page.getByRole('region', { name: 'Notifications', exact: true });

async function seed() {
  const unread = await db.notification.create({ data: { id: randomUUID(), userId: s.ownerId, title: 'Waiver signed', body: 'A waiver was signed.' } });
  const read = await db.notification.create({
    data: { id: randomUUID(), userId: s.ownerId, title: 'Payment received', body: 'A payment was received.', read: true, readAt: new Date(), createdAt: new Date(Date.now() - 60_000) },
  });
  notificationIds.push(unread.id, read.id);
  await db.notificationBroadcast.create({
    data: {
      id: randomUUID(), schoolId: s.schoolId, sentById: s.ownerId, sentByName: 'Earlier Owner', title: 'Closed Monday',
      body: 'No classes on the holiday.', audience: 'ALL', classAudience: [], recipientCount: 2,
    },
  });
}

test('the owner: header actions, number cards, the inbox rows and the sent messages, all in the new look', async ({ page }) => {
  await seed();
  await signIn(page, s.ownerToken);
  await page.goto('/notifications');

  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
  for (const name of ['Mark all read', 'Clear all read', 'Send a message to students']) {
    // Round pills, never the old square buttons.
    await expect(page.getByRole('button', { name })).toHaveCSS('border-radius', '999px');
  }
  // The main action is mint.
  await expect(page.getByRole('button', { name: 'Send a message to students' })).toHaveCSS('background-color', 'rgb(222, 242, 226)');

  // Number cards: each label, then its number.
  const value = (label: string) => page.getByText(label, { exact: true }).locator('xpath=following-sibling::*[1]');
  await expect(value('Total')).toHaveText('2');
  await expect(value('Unread')).toHaveText('1');
  await expect(value('Read within 24h')).toHaveText('100%');

  // The inbox: newest first, the status as a tag, the ⋯ menu on each row.
  const rows = inbox(page).getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Waiver signed');
  await expect(rows.nth(0)).toContainText('A waiver was signed.');
  await expect(rows.nth(0).getByText('New', { exact: true })).toBeVisible();
  await expect(rows.nth(1).getByText('Read', { exact: true })).toBeVisible();
  await rows.nth(0).getByRole('button', { name: 'Actions for Waiver signed' }).click();
  await expect(page.getByRole('menuitem', { name: 'Mark read' })).toBeEnabled();
  await expect(page.getByRole('menuitem', { name: 'Snooze' })).toBeEnabled();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeEnabled();
  await page.keyboard.press('Escape');

  // Sent messages: a card with its own heading.
  const sent = page.getByRole('region', { name: 'Messages sent to students' });
  await expect(sent.getByRole('row').nth(1)).toContainText('Closed Monday');
  await expect(sent.getByRole('row').nth(1)).toContainText('by Earlier Owner');

  // No right-hand panel, and nothing from the old look on the page.
  await expect(page.locator('.u8n-inspector')).toHaveCount(0);
  const main = page.locator('.u8n-content');
  await expect(main.locator('.ultm8-btn, .ultm8-badge, .ultm8-table, .ultm8-card, .ultm8-stat-tile, .ultm8-empty-state')).toHaveCount(0);
});

test('the Snooze and Broadcast forms use the new look\'s own drop-downs', async ({ page }) => {
  await seed();
  await signIn(page, s.ownerToken);
  await page.goto('/notifications');

  await inbox(page).getByRole('button', { name: 'Actions for Waiver signed' }).click();
  await page.getByRole('menuitem', { name: 'Snooze' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: 'Snooze for' })).toContainText('1 hour');
  await expect(dialog.locator('select')).toHaveCount(0);
  await dialog.getByRole('combobox', { name: 'Snooze for' }).click();
  await dialog.getByRole('option', { name: '3 days' }).click();
  await dialog.getByRole('button', { name: 'Snooze', exact: true }).click();
  await expect(inbox(page).getByRole('listitem').first().getByText('Snoozed', { exact: true })).toBeVisible();
  const snoozed = await db.notification.findUniqueOrThrow({ where: { id: notificationIds[0] } });
  // About three days from now.
  expect(snoozed.snoozedUntil!.getTime() - Date.now()).toBeGreaterThan(71 * 3_600_000);

  await page.getByRole('button', { name: 'Send a message to students' }).click();
  const compose = page.getByRole('dialog');
  await expect(compose.getByRole('combobox', { name: 'Send to' })).toContainText('All Students');
  await expect(compose.locator('select')).toHaveCount(0);
});

test('a coach sees their own inbox without the Owner-only Broadcast and sent messages', async ({ page }) => {
  const coach = await addPerson('Cora', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  const n = await db.notification.create({ data: { id: randomUUID(), userId: coach.id, title: 'Class moved', body: 'Open Mat has moved.' } });
  notificationIds.push(n.id);
  await signIn(page, coach.token);
  await page.goto('/notifications');

  await expect(inbox(page).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Mark all read' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Send a message to students' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Messages sent to students' })).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('nothing scrolls sideways, and each row keeps its menu', async ({ page }) => {
    await seed();
    await signIn(page, s.ownerToken);
    await page.goto('/notifications');
    await expect(inbox(page).getByRole('listitem')).toHaveCount(2);
    await expect(page.getByRole('region', { name: 'Messages sent to students' })).toContainText('Closed Monday');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(inbox(page).getByRole('button', { name: 'Actions for Payment received' })).toBeVisible();
  });
});
