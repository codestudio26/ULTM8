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
const classIds: string[] = [];

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterEach(async () => {
  await db.notification.deleteMany({ where: { id: { in: notificationIds } } });
  notificationIds.length = 0;
  await db.class.deleteMany({ where: { id: { in: classIds } } });
  classIds.length = 0;
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

test('Delete and Clear all read — hide notifications from the list and the stats, keeping the records (Decision 277)', async ({ page }) => {
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

  await page.getByRole('button', { name: 'Send a message to students' }).click();
  await expect(page.getByRole('heading', { name: 'Send a message to students' })).toBeVisible();
  await page.getByLabel('Title').fill('Holiday schedule');
  await page.getByLabel('Message', { exact: true }).fill('The school will be closed next Monday.');
  // Audience defaults to "All Students" — left unchanged.
  await page.getByRole('button', { name: 'Send message' }).click();

  // Exactly `student` + `newStudent` from seedGradingSchool() — no other
  // active Student exists at this School.
  await expect(page.getByText('Sent to 2 Students')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'Send a message to students' })).toHaveCount(0);
});

test('Broadcast to Students — Branch audience reaches only that Branch', async ({ page }) => {
  const branch = await addBranch(s, 'Uptown');
  branchIds.push(branch.id);
  await db.studentHomeBranch.create({
    data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.newStudent.id, branchId: branch.id },
  });

  await signIn(page, s.ownerToken);
  await page.goto('/notifications');

  await page.getByRole('button', { name: 'Send a message to students' }).click();
  await page.getByLabel('Title').fill('Uptown closure');
  await page.getByLabel('Message', { exact: true }).fill('Uptown is closed for maintenance.');
  await page.getByLabel('Send to').selectOption('BRANCH');
  await page.getByLabel('Branch').selectOption({ label: 'Uptown' });
  await page.getByRole('button', { name: 'Send message' }).click();

  // Only `newStudent` has a home Branch at Uptown — `student` does not.
  await expect(page.getByText('Sent to 1 Student')).toBeVisible();
});

test('Load more shows notifications past the newest 20, and the bell follows the Unread count', async ({ page }) => {
  for (let i = 0; i < 25; i++) {
    const n = await db.notification.create({
      data: { id: randomUUID(), userId: s.ownerId, title: `Inbox item ${i}`, body: 'x', read: i < 24, createdAt: new Date(Date.now() - i * 60_000) },
    });
    notificationIds.push(n.id);
  }

  await signIn(page, s.ownerToken);
  await page.goto('/notifications');
  await expect(page.getByRole('row', { name: /Inbox item 0\b/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Inbox item \d+/ })).toHaveCount(20);

  // The only unread one is the oldest, past the first page: the bell still
  // shows it, because it reads the Unread count rather than the loaded rows.
  const bell = page.locator('a[href="/notifications"][aria-label="Notifications"]');
  await expect(bell.locator('span')).toHaveCount(1);

  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByRole('row', { name: /Inbox item \d+/ })).toHaveCount(25);
  await expect(page.getByRole('row', { name: /Inbox item 24\b/ }).getByText('New')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);

  // Snooze is greyed out on a read notification.
  await page.getByRole('button', { name: 'Actions for Inbox item 0' }).click();
  await expect(page.getByRole('menuitem', { name: 'Snooze' })).toBeDisabled();
  await page.keyboard.press('Escape');

  // Snoozing the one unread notification turns the bell's dot off.
  await page.getByRole('button', { name: 'Actions for Inbox item 24' }).click();
  await page.getByRole('menuitem', { name: 'Snooze' }).click();
  await page.getByRole('button', { name: 'Snooze' }).click();
  await expect(page.getByRole('row', { name: /Inbox item 24\b/ }).getByText('Snoozed')).toBeVisible();
  await expect(bell.locator('span')).toHaveCount(0);
});

test('Broadcast to one class — the picker lists upcoming classes only, soonest first, with their date', async ({ page }) => {
  const day = 86_400_000;
  const mk = (title: string, offsetDays: number, archived = false) =>
    db.class.create({
      data: {
        id: randomUUID(), schoolId: s.schoolId, title, startDate: new Date(Date.now() + offsetDays * day),
        endDate: new Date(Date.now() + offsetDays * day + 3_600_000), archivedAt: archived ? new Date() : null,
      },
    });
  const later = await mk('Kids BJJ', 9);
  const sooner = await mk('Kids BJJ', 2);
  const past = await mk('Past Class', -3);
  const archived = await mk('Archived Class', 4, true);
  classIds.push(later.id, sooner.id, past.id, archived.id);

  await signIn(page, s.ownerToken);
  await page.goto('/notifications');
  await page.getByRole('button', { name: 'Send a message to students' }).click();
  await page.getByLabel('Send to').selectOption('CLASS');

  const options = await page.getByLabel('Class').locator('option').allTextContents();
  const kids = options.filter((o) => o.startsWith('Kids BJJ'));
  expect(kids).toHaveLength(2);
  // Each carries its own date, so the two "Kids BJJ" weeks can be told apart,
  // and the sooner one comes first.
  expect(kids[0]).not.toBe(kids[1]);
  expect(options.indexOf(kids[0])).toBeLessThan(options.indexOf(kids[1]));
  const values = await page.getByLabel('Class').locator('option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  expect(values.indexOf(sooner.id)).toBeLessThan(values.indexOf(later.id));
  expect(options.some((o) => o.startsWith('Past Class'))).toBe(false);
  expect(options.some((o) => o.startsWith('Archived Class'))).toBe(false);
});

test('Broadcast to one class — the Owner ticks who on the class list gets it (Decision 333)', async ({ page }) => {
  const cls = await db.class.create({
    data: { id: randomUUID(), schoolId: s.schoolId, title: 'Teen Judo', startDate: new Date(Date.now() + 86_400_000), endDate: new Date(Date.now() + 90_000_000) },
  });
  classIds.push(cls.id);
  let sent: Record<string, unknown> | null = null;
  await page.route('**/v1/schools/*/notifications/broadcast', (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ broadcastId: randomUUID(), audience: 'CLASS', recipientCount: 1 }) });
  });

  await signIn(page, s.ownerToken);
  await page.goto('/notifications');
  await page.getByRole('button', { name: 'Send a message to students' }).click();
  await page.getByLabel('Title').fill('Mats moved');
  await page.getByLabel('Message', { exact: true }).fill('Class is in the back room tonight.');
  await page.getByLabel('Send to').selectOption('CLASS');
  await page.getByLabel('Class', { exact: true }).selectOption(cls.id);

  // Booked is ticked by default; nothing ticked is refused before sending.
  await expect(page.getByLabel('Booked')).toBeChecked();
  await expect(page.getByLabel('On the waitlist')).not.toBeChecked();
  await page.getByLabel('Booked').uncheck();
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Tick at least one group on the class list.')).toBeVisible();
  expect(sent).toBeNull();

  await page.getByLabel('On the waitlist').check();
  await page.getByLabel('Cancelled their booking').check();
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Sent to 1 Student')).toBeVisible();
  expect(sent).toMatchObject({ audience: 'CLASS', classId: cls.id, classAudience: ['WAITLIST', 'CANCELLED'] });
});

test('Mark all read, the School label, and clicking a notification opens its class (Decision 355)', async ({ page }) => {
  const cls = await db.class.create({
    data: { id: randomUUID(), schoolId: s.schoolId, title: 'Open Mat', startDate: new Date(Date.now() + 86_400_000), endDate: new Date(Date.now() + 90_000_000) },
  });
  classIds.push(cls.id);
  const school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId }, select: { name: true } });
  const opens = await db.notification.create({
    data: { id: randomUUID(), userId: s.ownerId, title: 'Class moved', body: 'Open Mat has moved.', schoolId: s.schoolId, schoolName: school.name, targetType: 'CLASS', targetId: cls.id },
  });
  const plain = await db.notification.create({ data: { id: randomUUID(), userId: s.ownerId, title: 'Just news', body: 'Nothing to open.' } });
  notificationIds.push(opens.id, plain.id);

  await signIn(page, s.ownerToken);
  await page.goto('/notifications');
  // The School it came from sits under the title; a notification with nothing
  // to open has a plain title.
  await expect(page.getByRole('cell', { name: `Class moved ${school.name}` })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Just news' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Class moved' }).click();
  await expect(page).toHaveURL(new RegExp(`/classes/${cls.id}$`));
  await expect.poll(async () => (await db.notification.findUniqueOrThrow({ where: { id: opens.id } })).read).toBe(true);

  await page.goto('/notifications');
  const markAll = page.getByRole('button', { name: 'Mark all read' });
  await expect(markAll).toBeEnabled();
  await markAll.click();
  await expect(markAll).toBeDisabled();
  expect((await db.notification.findUniqueOrThrow({ where: { id: plain.id } })).read).toBe(true);
});
