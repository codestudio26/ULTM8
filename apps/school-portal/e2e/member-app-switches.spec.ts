import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Member app switches (Decision 318 item 7): on the School page the owner
 * turns off what members may do themselves in the ULTM8 app, and turns on
 * the grading countdown with the School's next grading day.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterAll(async () => {
  await cleanup();
});

test('the owner sets the member app switches and the next grading day', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/school');
  const card = page.locator('#member-app');
  await expect(card.getByText('Member app')).toBeVisible();
  await expect(card.getByLabel('Members can edit their own profile')).toBeChecked();
  await expect(card.getByLabel('Members can cancel their own membership')).toBeChecked();
  await expect(card.getByLabel('Parents can add their children')).toBeChecked();
  await expect(card.getByLabel('Members can see their payment history')).toBeChecked();
  await expect(card.getByLabel('Show the grading countdown')).not.toBeChecked();

  await card.getByLabel('Members can cancel their own membership').uncheck();
  await card.getByLabel('Members can see their payment history').uncheck();
  await card.getByLabel('Show the grading countdown').check();
  await card.getByLabel('Next grading day').fill('2027-03-24');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByText('Saved.')).toBeVisible();

  const school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(school.memberAppEditProfile).toBe(true);
  expect(school.memberAppCancelMembership).toBe(false);
  expect(school.memberAppAddFamily).toBe(true);
  expect(school.memberAppPaymentHistory).toBe(false);
  expect(school.memberAppGradingCountdown).toBe(true);
  expect(school.nextGradingDate?.toISOString().slice(0, 10)).toBe('2027-03-24');

  await page.reload();
  await expect(page.locator('#member-app').getByLabel('Next grading day')).toHaveValue('2027-03-24');
  await expect(page.locator('#member-app').getByLabel('Members can see their payment history')).not.toBeChecked();
});
