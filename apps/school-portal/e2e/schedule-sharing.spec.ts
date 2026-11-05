import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 319 item 4: on the School page the owner switches on staff
 * calendar links and the schedule embed (and gets the snippet); on My
 * Profile a staff member gets their private calendar link.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  await db.staffCalendarFeed.deleteMany({ where: { schoolId: s.schoolId } });
});

test.afterAll(async () => {
  await cleanup();
});

test('the owner turns on the schedule embed and calendar links, and gets their own calendar link', async ({ page }) => {
  await page.goto('/school');
  const card = page.getByRole('region', { name: 'Calendar and website' });
  await expect(card).toBeVisible();
  await card.getByLabel('Show your schedule on your website').click();
  const snippet = card.getByLabel('Paste this into your website');
  await expect(snippet).toHaveValue(/<iframe src="http:\/\/localhost:\d+\/v1\/schedule-embeds\/[A-Za-z0-9_-]+\/page\?lang=/);
  const key = (await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).scheduleEmbedKey;
  expect(key).toBeTruthy();

  await card.getByRole('button', { name: 'New link' }).click();
  await expect.poll(async () => (await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).scheduleEmbedKey).not.toBe(key);

  await card.getByLabel('Staff can add their classes to Google Calendar').click();
  await expect.poll(async () => (await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).staffCalendarFeedsEnabled).toBe(true);

  await page.goto('/profile');
  const mine = page.getByRole('region', { name: 'My classes in Google Calendar' });
  await mine.getByRole('button', { name: 'Get my calendar link' }).click();
  await expect(mine.getByLabel('Your private calendar link')).toHaveValue(/\/v1\/calendar-feeds\/[A-Za-z0-9_-]+\.ics$/);
  await mine.getByRole('button', { name: 'Stop' }).click();
  await expect(mine.getByRole('button', { name: 'Get my calendar link' })).toBeVisible();
});

test("My Profile says so when the School hasn't switched calendar links on", async ({ page }) => {
  await page.goto('/profile');
  await expect(page.getByRole('region', { name: 'My classes in Google Calendar' }).getByText("Your School hasn't switched this on yet.")).toBeVisible();
});
