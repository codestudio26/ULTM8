import { expect, test } from '@playwright/test';
import { addBranch, addPerson, cleanup, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * StaffPage's own find-then-confirm invite flow (Decisions 80/81, 168/169):
 * find a candidate by email/phone, then choose Role and Branch. The Branch
 * <SelectField> here used to carry the native `required` attribute, which let
 * the browser's own constraint-validation popup block submission before
 * handleInvite's branchId check ever ran. coach-invites.spec.ts and
 * branch-staff.spec.ts only cover CoachInvitesSection's separate one-step
 * invite form, so this flow had no coverage of its own.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // a School without branches until addBranch is called
});

test.afterAll(async () => {
  await cleanup();
});

test('submitting the invite with no Branch chosen shows the page error, not a native popup', async ({ page }) => {
  await addBranch(s, 'North');
  const candidate = await addPerson('Nora', 'Newcoach');
  await signIn(page, s.ownerToken);
  await page.goto('/staff');

  await page.getByLabel('Email').fill(candidate.email);
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.getByText('Found Nora Newcoach.')).toBeVisible();

  await page.getByLabel('Role').selectOption({ label: 'Branch Staff' });
  // Two "Send invite" buttons are on this page (this form's and
  // CoachInvitesSection's below it); this one is the first.
  await page.getByRole('button', { name: 'Send invite' }).first().click();
  await expect(page.getByText('Select a Branch for Branch Staff.')).toBeVisible();
});
