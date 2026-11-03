import { expect, test } from '@playwright/test';
import { addBranch, addCoachInvite, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Coach invites (Decision 183), against the real API: the main owner invites
 * and cancels on the Staff page (Decision 423 item 10: nobody else adds
 * people, and "Can invite coaches" is gone); the invited person accepts
 * through the link and keeps their student role.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // a School without branches
});

test.afterAll(async () => {
  await cleanup();
});

test('the owner sends an invite, sees it waiting, and cancels it', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/staff');
  await page.getByLabel("Coach's email").fill('new.coach@example.test');
  await page.getByRole('button', { name: 'Send invite' }).last().click();
  // No email provider in the test environment: the invite is kept, with a warning.
  await expect(page.getByText("The invite to new.coach@example.test was saved, but the email couldn't be sent.")).toBeVisible();
  const row = page.getByRole('row', { name: /new\.coach@example\.test/ });
  await expect(row.getByText('Waiting')).toBeVisible();
  await expect(row.getByText('by Olive Owner')).toBeVisible();

  await row.getByRole('button', { name: 'Cancel invite to new.coach@example.test' }).click();
  await expect(row.getByText('Cancelled')).toBeVisible();
  const invite = await db.coachInvite.findFirstOrThrow({ where: { schoolId: s.schoolId } });
  expect(invite.cancelledAt).not.toBeNull();
});

test('only the main owner adds or removes people: a co-owner sees a note instead (Decision 423 item 10)', async ({ page }) => {
  const north = await addBranch(s, 'North');
  await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId, branchId: north.id }]);
  const coOwner = await addPerson('Cora', 'Partner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: s.schoolId }]);
  await addCoachInvite(s, 'waiting.coach@example.test');

  // The Access window no longer has "Invite coaches".
  await signIn(page, s.ownerToken);
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Actions for Bea Desk' }).click();
  await page.getByRole('menuitem', { name: 'Access' }).click();
  const dialog = page.getByRole('dialog', { name: 'Access for Bea Desk' });
  await expect(dialog.getByLabel('See the staff list')).toBeVisible();
  await expect(dialog.getByLabel('Invite coaches')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // A co-owner: the lists, read only, and the note.
  await signIn(page, coOwner.token);
  await page.goto('/staff');
  await expect(page.getByText("Only the account's main owner can add or remove people.").first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add staff manually' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Find' })).toHaveCount(0);
  await expect(page.getByLabel("Coach's email")).toHaveCount(0);
  const row = page.getByRole('row', { name: /waiting\.coach@example\.test/ });
  await expect(row.getByText('Waiting', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: /Cancel invite/ })).toHaveCount(0);
  // Edit details and Access stay; removing and pausing don't show.
  await page.getByRole('button', { name: 'Actions for Bea Desk' }).click();
  await expect(page.getByRole('menuitem', { name: 'Access' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Remove/ })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Pause' })).toHaveCount(0);
});

test('a student accepts through the link and becomes a coach too', async ({ page }) => {
  const sam = await addPerson('Sam', 'Train', [{ role: 'STUDENT', schoolId: s.schoolId }]);
  const token = await addCoachInvite(s, sam.email);
  await signIn(page, sam.token);
  await page.goto(`/coach-invite/${token}`);
  await expect(page.getByRole('heading', { name: "You're invited to coach" })).toBeVisible();
  await expect(page.getByText(/Portal E2E/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Accept invite' }).click();
  await expect(page.getByText(/You're now a coach at Portal E2E/)).toBeVisible();

  const roles = (await db.roleGrant.findMany({ where: { userId: sam.id, revokedAt: null } })).map((g) => g.role).sort();
  expect(roles).toEqual(['INSTRUCTOR', 'STUDENT']);
  await page.reload();
  await expect(page.getByText('This invite has already been used.')).toBeVisible();
});

test('signed out, the link asks them to log in or create their account', async ({ page }) => {
  const token = await addCoachInvite(s, 'Fresh.Coach@example.test');
  await page.goto(`/coach-invite/${token}`);
  await expect(page.getByText('This invite is for fresh.coach@example.test.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByLabel('Email')).toHaveValue('fresh.coach@example.test');
});

test('signed in as someone else, it says whose invite it is; expired links say so', async ({ page }) => {
  const other = await addPerson('Ollie', 'Other');
  const token = await addCoachInvite(s, 'someone.else@example.test');
  await signIn(page, other.token);
  await page.goto(`/coach-invite/${token}`);
  await expect(page.getByText(`but you're logged in as ${other.email}`, { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log in as someone.else@example.test' })).toBeVisible();

  const old = await addCoachInvite(s, 'late@example.test', { expiresAt: new Date(Date.now() - 1000) });
  await page.goto(`/coach-invite/${old}`);
  await expect(page.getByText('This invite has expired. Ask the school for a new one.')).toBeVisible();
});
