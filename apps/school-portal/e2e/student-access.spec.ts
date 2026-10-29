import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * App access for a new student (backlog 3.3, Decision 403): a child added by
 * hand gets their Guardian's account and temporary passcode, or an invite
 * when the Guardian already has an account; the owner sees the waiting
 * invites and can make a new temporary passcode on the student's page.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

/** Removes a Guardian made by the test, their children and enrolments. */
async function removeFamily(guardianEmail: string) {
  const guardian = await db.user.findUnique({ where: { email: guardianEmail } });
  if (!guardian) return;
  const links = await db.guardianLink.findMany({ where: { guardianId: guardian.id } });
  const ids = [guardian.id, ...links.map((l) => l.studentId)];
  await db.childInvite.deleteMany({ where: { OR: [{ guardianId: guardian.id }, { studentId: { in: ids } }] } });
  await db.notification.deleteMany({ where: { userId: { in: ids } } });
  await db.waiverSignature.deleteMany({ where: { studentId: { in: ids } } });
  await db.studentHomeBranch.deleteMany({ where: { studentId: { in: ids } } });
  await db.roleGrant.deleteMany({ where: { userId: { in: ids } } });
  await db.guardianLink.deleteMany({ where: { guardianId: guardian.id } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

async function fillChild(page: import('@playwright/test').Page, guardianEmail: string) {
  await page.goto('/students/add');
  await page.getByLabel('First name').first().fill('Kit');
  await page.getByLabel('Surname').first().fill('Young');
  await page.getByLabel('Date of birth').fill('2016-03-04');
  const guardian = page.getByRole('group', { name: 'Guardian' });
  await expect(guardian).toBeVisible();
  await expect(page.locator('#add-student-email')).toHaveCount(0);
  await guardian.getByLabel('First name').fill('Gwen');
  await guardian.getByLabel('Surname').fill('Young');
  await guardian.getByLabel('Email').fill(guardianEmail);
  await page.getByRole('button', { name: 'Add Student' }).click();
}

test('a child with a new Guardian: added and enrolled, and the Guardian\'s temporary passcode is shown once', async ({ page }) => {
  const email = `guardian-${randomUUID()}@example.test`;
  try {
    await fillChild(page, email);
    await expect(page.getByText('Kit Young has been added, with Gwen Young as their Guardian.')).toBeVisible();
    await expect(page.getByText('Give Gwen Young this temporary passcode:')).toBeVisible();
    await expect(page.getByTestId('temporary-passcode')).toHaveText(/^\d{6}$/);
    const guardian = await db.user.findUniqueOrThrow({ where: { email } });
    expect(guardian.mustChangePasscode).toBe(true);
    const link = await db.guardianLink.findFirstOrThrow({ where: { guardianId: guardian.id } });

    // On the child's page the owner can make a new one for the Guardian.
    await page.goto(`/students/${link.studentId}`);
    const access = page.getByRole('region', { name: 'App access' });
    await expect(access.getByText("Their Guardian, Gwen Young, hasn't signed in yet.")).toBeVisible();
    await access.getByRole('button', { name: 'New temporary passcode' }).click();
    await expect(access.getByText('New temporary passcode for Gwen Young:')).toBeVisible();
    await expect(access.getByTestId('temporary-passcode')).toHaveText(/^\d{6}$/);
  } finally {
    await removeFamily(email);
  }
});

test('a child whose Guardian has an account: an invite, listed until the owner withdraws it', async ({ page }) => {
  const guardian = await addPerson('Gina', 'Account');
  try {
    await fillChild(page, guardian.email);
    await expect(page.getByText(`${guardian.email} already has a ULTM8 account. We've asked them to accept Kit Young in the app. Kit Young is enrolled once they accept.`)).toBeVisible();
    await expect(page.getByTestId('temporary-passcode')).toHaveCount(0);

    await page.goto('/students');
    const waiting = page.getByRole('region', { name: 'Waiting for a Guardian' });
    await expect(waiting.getByText('Kit Young, for Gina Account')).toBeVisible();
    await waiting.getByRole('button', { name: 'Withdraw the invite for Kit Young' }).click();
    await expect(waiting).toHaveCount(0);
    expect((await db.childInvite.findFirstOrThrow({ where: { guardianId: guardian.id } })).status).toBe('WITHDRAWN');
  } finally {
    await db.childInvite.deleteMany({ where: { guardianId: guardian.id } });
  }
});
