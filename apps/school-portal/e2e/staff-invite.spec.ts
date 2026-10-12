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

  // This form shares the page with CoachInvitesSection's own "Coach's
  // email"/"Branch"/"Send invite" form below it; it's the first <form> in
  // document order.
  const staffForm = page.locator('form').first();
  await staffForm.getByLabel('Email', { exact: true }).fill(candidate.email);
  await staffForm.getByRole('button', { name: 'Find' }).click();
  await expect(page.getByText('Found Nora Newcoach.')).toBeVisible();

  await staffForm.getByLabel('Role', { exact: true }).selectOption({ label: 'Branch Staff' });
  await staffForm.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText('Select a Branch for Branch Staff.')).toBeVisible();
});
