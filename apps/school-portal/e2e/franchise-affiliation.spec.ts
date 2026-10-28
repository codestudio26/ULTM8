import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 232 — leave/switch-Franchise, and Decision 352 — joining is a
 * request the Franchise Owner accepts or declines. Covers the Franchise
 * affiliation card on SchoolPage: ask to join (cancel, declined, accepted),
 * leave, then switch (ask to join a different Franchise after leaving).
 */
let s: GradingSchool;
const franchiseIds: string[] = [];

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  await db.roleGrant.deleteMany({ where: { franchiseId: { in: franchiseIds } } });
  await db.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
  franchiseIds.length = 0;
});

test.afterAll(async () => {
  await cleanup();
});

/** Decision 352 — the Franchise Owner's side of accepting is in
 * franchise-review-fixes.spec.ts; here it is done straight in the database. */
async function acceptLatestRequest(schoolId: string) {
  const req = await db.franchiseJoinRequest.findFirstOrThrow({ where: { schoolId, status: 'PENDING' } });
  await db.franchiseJoinRequest.update({ where: { id: req.id }, data: { status: 'ACCEPTED', decidedAt: new Date() } });
  await db.school.update({ where: { id: schoolId }, data: { franchiseId: req.franchiseId } });
}

/** Decision 368 (Q4) — "Ask to join" shows the Franchise's name first; "Send request" sends it. */
async function askToJoin(page: Page) {
  await page.getByRole('button', { name: 'Ask to join' }).click();
  await page.getByRole('dialog', { name: 'Ask to join this Franchise?' }).getByRole('button', { name: 'Send request' }).click();
}

test('School Owner asks to join, leaves, then switches Franchise from the School profile page', async ({ page }) => {
  const franchiseA = await db.franchise.create({ data: { id: randomUUID(), name: 'Affiliation Test Franchise A' } });
  franchiseIds.push(franchiseA.id);

  await page.goto('/school');
  await expect(page.getByRole('heading', { name: 'Franchise affiliation' })).toBeVisible();
  await expect(page.getByText('This School is independent')).toBeVisible();

  // Decision 352 — asking does not join; the School can withdraw the request.
  await page.getByLabel('Franchise ID').fill(franchiseA.id);
  await askToJoin(page);
  const pending = page.getByTestId('franchise-join-pending');
  await expect(pending).toContainText(`Waiting for Franchise ${franchiseA.id} to accept your request to join.`);
  expect((await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).franchiseId).toBeNull();
  await pending.getByRole('button', { name: 'Cancel request' }).click();
  await expect(pending).toHaveCount(0);
  await expect(page.getByLabel('Franchise ID')).toBeVisible();

  // A declined request says so, and the School can ask again.
  await page.getByLabel('Franchise ID').fill(franchiseA.id);
  await askToJoin(page);
  await expect(pending).toBeVisible();
  await db.franchiseJoinRequest.updateMany({ where: { schoolId: s.schoolId, status: 'PENDING' }, data: { status: 'DECLINED', decidedAt: new Date() } });
  await page.reload();
  await expect(page.getByTestId('franchise-join-declined')).toContainText(`Franchise ${franchiseA.id} declined your request to join.`);

  await page.getByLabel('Franchise ID').fill(franchiseA.id);
  await askToJoin(page);
  await expect(pending).toBeVisible();
  await acceptLatestRequest(s.schoolId);
  await page.reload();

  await expect(page.getByText(franchiseA.id)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Leave Franchise' })).toBeVisible();

  // Decision 337 (F6) — Leave asks first; Cancel keeps the School in.
  await page.getByRole('button', { name: 'Leave Franchise' }).click();
  const confirm = page.getByRole('dialog', { name: 'Leave this Franchise?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  expect((await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).franchiseId).toBe(franchiseA.id);

  await page.getByRole('button', { name: 'Leave Franchise' }).click();
  await page.getByRole('dialog', { name: 'Leave this Franchise?' }).getByRole('button', { name: 'Leave Franchise' }).click();
  await expect(page.getByText('This School is independent')).toBeVisible();

  const afterLeave = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(afterLeave.franchiseId).toBeNull();

  // Switch — ask to join a second, different Franchise now that leaving
  // cleared the old membership.
  const franchiseB = await db.franchise.create({ data: { id: randomUUID(), name: 'Affiliation Test Franchise B' } });
  franchiseIds.push(franchiseB.id);

  await page.getByLabel('Franchise ID').fill(franchiseB.id);
  await askToJoin(page);
  await expect(pending).toContainText(franchiseB.id);
  await acceptLatestRequest(s.schoolId);
  await page.reload();
  await expect(page.getByText(franchiseB.id)).toBeVisible();

  const afterSwitch = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
  expect(afterSwitch.franchiseId).toBe(franchiseB.id);
});

test("Decision 350 — the Franchise's name and logo show only when both owners allow it", async ({ page }) => {
  const name = `Branding Test Franchise ${randomUUID().slice(0, 8)}`;
  const franchise = await db.franchise.create({ data: { id: randomUUID(), name } });
  franchiseIds.push(franchise.id);
  await db.school.update({ where: { id: s.schoolId }, data: { franchiseId: franchise.id } });

  await page.goto('/school');
  const toggle = page.getByRole('switch', { name: "Show the Franchise's name and logo" });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('franchise-branding-not-allowed')).toBeVisible();

  // The School Owner turns it on first: kept, but nothing shows yet.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).showFranchiseBranding).toBe(true);
  await expect(page.getByTestId('franchise-branding-preview')).toHaveCount(0);
  await expect(page.getByTestId('footer-franchise-branding')).toHaveCount(0);

  // Then the Franchise Owner allows it: the name shows, here and in the footer.
  await db.franchise.update({ where: { id: franchise.id }, data: { shareBrandingWithMembers: true } });
  await page.reload();
  await expect(page.getByTestId('franchise-branding-preview')).toHaveText(`Shown as: Part of ${name}`);
  await expect(page.getByTestId('footer-franchise-branding')).toHaveText(`Part of ${name}`);

  // The School Owner turns it off again.
  await page.getByRole('switch', { name: "Show the Franchise's name and logo" }).click();
  await expect(page.getByTestId('footer-franchise-branding')).toHaveCount(0);
  await expect.poll(async () => (await db.school.findUniqueOrThrow({ where: { id: s.schoolId } })).showFranchiseBranding).toBe(false);
});
