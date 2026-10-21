import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addBranch, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Notifications page — v1.2 backend backlog, three product-owner-approved
 * features: Broadcast/compose, Snooze, and the Read-within-24h stat tile.
 * `seedGradingSchool()` conveniently already enrolls exactly two Students
 * (`student`, `newStudent`) with no home Branch — used here as the "All
 * Students" audience fixture; Branch targeting gets its own dedicated
 * Student via `db.studentHomeBranch.create`.
 */
let s: GradingSchool;
const notificationIds: string[] = [];
const branchIds: string[] = [];

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterEach(async () => {
  await db.notification.deleteMany({ where: { id: { in: notificationIds } } });
  notificationIds.length = 0;
  await db.studentHomeBranch.deleteMany({ where: { branchId: { in: branchIds } } });
  await db.branch.deleteMany({ where: { id: { in: branchIds } } });
  branchIds.length = 0;
});

test.afterAll(async () => {
  await cleanup();
});

test('row action menu — Mark read and Snooze are real, and update the stats ribbon', async ({ page }) => {
  const n1 = await db.notification.create({
    data: { id: randomUUID(), userId: s.ownerId, title: 'Waiver signed', body: 'A waiver was signed.' },
  });
  const n2 = await db.notification.create({
    data: { id: randomUUID(), userId: s.ownerId, title: 'Payment received', body: 'A payment was received.' },
  });
  notificationIds.push(n1.id, n2.id);

  await signIn(page, s.ownerToken);
  await page.goto('/notifications');

  // Read within 24h starts at "—" — nothing has ever been read yet.
  const readTileValue = page.getByText('Read within 24h', { exact: true }).locator('xpath=following-sibling::*[1]');
  await expect(readTileValue).toHaveText('—');

  await expect(page.getByRole('row', { name: /Waiver signed/ }).getByText('New')).toBeVisible();
  await expect(page.getByRole('row', { name: /Payment received/ }).getByText('New')).toBeVisible();

  // Mark read via the row action menu (previously a plain always-visible
  // Button; now a RowActionsMenu item, same as every other dense list page).
  await page.getByRole('row', { name: /Waiver signed/ }).getByRole('button', { name: 'Actions for Waiver signed' }).click();
  await page.getByRole('menuitem', { name: 'Mark read' }).click();
  await expect(page.getByRole('row', { name: /Waiver signed/ }).getByText('Read', { exact: true })).toBeVisible();

  // Read within 24h — now backed by one read Notification, read well within
  // 24h of being created a moment ago.
  await expect(readTileValue).toHaveText('100%');

  // Snooze — previously shown disabled-styled in the backlog's referenced
  // concept mockup; now real (PATCH /notifications/:id/snooze).
  await page.getByRole('row', { name: /Payment received/ }).getByRole('button', { name: 'Actions for Payment received' }).click();
  await page.getByRole('menuitem', { name: 'Snooze' }).click();
  await expect(page.getByRole('heading', { name: 'Snooze notification' })).toBeVisible();
  await page.getByRole('button', { name: 'Snooze' }).click();
  await expect(page.getByRole('heading', { name: 'Snooze notification' })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Payment received/ }).getByText('Snoozed')).toBeVisible();

  const snoozed = await db.notification.findUniqueOrThrow({ where: { id: n2.id } });
  expect(snoozed.snoozedUntil).not.toBeNull();
  expect(snoozed.snoozedUntil!.getTime()).toBeGreaterThan(Date.now());
});

test('Delete and Clear all read — hide notifications from the list and the stats, keeping the records (Decision 274)', async ({ page }) => {
  const n1 = await db.notification.create({
    data: { id: randomUUID(), userId: s.ownerId, title: 'Old alert', body: 'Delete me.' },
  });
  const n2 = await db.notification.create({
    data: { id: randomUUID(), userId: s.ownerId, title: 'Payment failed', body: 'Already read.', read: true, readAt: new Date() },
  });
  const n3 = await db.notification.create({
    data: { id: randomUUID(), userId: s.ownerId, title: 'Waiver due', body: 'Still unread.' },
  });
  notificationIds.push(n1.id, n2.id, n3.id);

  await signIn(page, s.ownerToken);
  await page.goto('/notifications');
  const totalTileValue = page.getByText('Total', { exact: true }).locator('xpath=following-sibling::*[1]');
  await expect(totalTileValue).toHaveText('3');

  // Delete one, through the row menu and a confirmation.
  await page.getByRole('button', { name: 'Actions for Old alert' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: 'Delete notification?' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('row', { name: /Old alert/ })).toHaveCount(0);
  await expect(totalTileValue).toHaveText('2');

  // Clear all read: removes the read one, keeps the unread one.
  await page.getByRole('button', { name: 'Clear all read' }).click();
  await expect(page.getByRole('heading', { name: 'Clear all read notifications?' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear all read' }).click();
  await expect(page.getByRole('row', { name: /Payment failed/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Waiver due/ })).toBeVisible();
  await expect(totalTileValue).toHaveText('1');
  // Nothing read is left, so the action is disabled.
  await expect(page.getByRole('button', { name: 'Clear all read' })).toBeDisabled();

  // Soft delete: both records are still there, only hidden.
  const kept = await db.notification.findMany({ where: { id: { in: [n1.id, n2.id] } } });
  expect(kept).toHaveLength(2);
  expect(kept.every((n) => n.deletedAt !== null)).toBe(true);
});

test('Broadcast to Students — All Students (default) reaches every active Student at the School', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/notifications');

  await page.getByRole('button', { name: 'Broadcast to Students' }).click();
  await expect(page.getByRole('heading', { name: 'Broadcast to Students' })).toBeVisible();
  await page.getByLabel('Title').fill('Holiday schedule');
  await page.getByLabel('Message').fill('The school will be closed next Monday.');
  // Audience defaults to "All Students" — left unchanged.
  await page.getByRole('button', { name: 'Send broadcast' }).click();

  // Exactly `student` + `newStudent` from seedGradingSchool() — no other
  // active Student exists at this School.
  await expect(page.getByText('Sent to 2 Students')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'Broadcast to Students' })).toHaveCount(0);
});

test('Broadcast to Students — Branch audience reaches only that Branch', async ({ page }) => {
  const branch = await addBranch(s, 'Uptown');
  branchIds.push(branch.id);
  await db.studentHomeBranch.create({
    data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.newStudent.id, branchId: branch.id },
  });

  await signIn(page, s.ownerToken);
  await page.goto('/notifications');

  await page.getByRole('button', { name: 'Broadcast to Students' }).click();
  await page.getByLabel('Title').fill('Uptown closure');
  await page.getByLabel('Message').fill('Uptown is closed for maintenance.');
  await page.getByLabel('Send to').selectOption('BRANCH');
  await page.getByLabel('Branch').selectOption({ label: 'Uptown' });
  await page.getByRole('button', { name: 'Send broadcast' }).click();

  // Only `newStudent` has a home Branch at Uptown — `student` does not.
  await expect(page.getByText('Sent to 1 Student')).toBeVisible();
});
