import { randomUUID, createHmac } from 'crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { addBranch, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The Organisation pages in the new look (Decision 453): Branches, the
 * Franchises list and a Franchise's page, and the School page. Same data,
 * actions and permissions as before; the controls are the new look's own
 * (our drop-downs, round pills, white cards), and nothing old-looking is left
 * in the page.
 */
function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signToken(payload: object): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET is not set');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify({ ...payload, iat: now, exp: now + 3600 }));
  const signature = base64url(createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${signature}`;
}

/** Every shared button in `scope` is a round pill (the new look), none square. */
async function expectRoundButtons(scope: Locator) {
  const radii = await scope.locator('button.ultm8-btn, button.u8n-pill').evaluateAll((els) => els.map((el) => getComputedStyle(el).borderTopLeftRadius));
  expect(radii.length).toBeGreaterThan(0);
  for (const r of radii) expect(parseFloat(r)).toBeGreaterThanOrEqual(18);
}

const main = (page: Page) => page.locator('.u8o');

test.describe('Branches', () => {
  let s: GradingSchool;
  const branchIds: string[] = [];

  test.beforeEach(async () => {
    s = await seedGradingSchool();
  });
  test.afterEach(async () => {
    await db.branch.deleteMany({ where: { id: { in: branchIds } } });
    branchIds.length = 0;
  });
  test.afterAll(async () => {
    await cleanup();
  });

  test('one list card: search, our own City drop-down, Show closed chip, Settings and ⋮ on each row', async ({ page }) => {
    const north = await addBranch(s, 'Org North');
    const old = await db.branch.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'Org Old', archivedAt: new Date() } });
    branchIds.push(north.id, old.id);
    await signIn(page, s.ownerToken);
    await page.goto('/branches');

    await expect(page.getByRole('heading', { level: 1, name: 'Branches' })).toBeVisible();
    const list = page.getByRole('region', { name: 'Branches' });
    await expect(list.getByRole('searchbox', { name: 'Search', exact: true })).toBeVisible();
    await expect(list.getByRole('combobox', { name: 'City' })).toBeVisible();
    await expect(list.locator('select')).toHaveCount(0);

    // Closed Branches are hidden until the chip is pressed.
    const showClosed = list.getByRole('button', { name: 'Show closed (1)' });
    await expect(showClosed).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('cell', { name: 'Org Old' })).toHaveCount(0);
    await showClosed.click();
    await expect(showClosed).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('row', { name: /Org Old/ }).getByText('Closed', { exact: true })).toBeVisible();

    const row = page.getByRole('row', { name: /Org North/ });
    await expect(row.getByRole('button', { name: 'Actions for Org North' })).toBeVisible();
    await expectRoundButtons(list);
    await row.getByRole('button', { name: 'Settings' }).click();
    await expect(page).toHaveURL(new RegExp(`/branches/${north.id}$`));
  });

  test('the grid view keeps every detail and action, as cards', async ({ page }) => {
    const north = await addBranch(s, 'Org Grid');
    branchIds.push(north.id);
    await signIn(page, s.ownerToken);
    await page.goto('/branches');
    await page.getByRole('button', { name: 'Grid' }).click();
    const card = page.locator('.u8n-grid__card', { hasText: 'Org Grid' });
    await expect(card.getByText('0 students · 0 upcoming classes')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Settings' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Actions for Org Grid' })).toBeVisible();
  });

  test('the School page: header with the School name, white setting cards, round buttons, red-outlined Close card', async ({ page }) => {
    const school = await db.school.findUniqueOrThrow({ where: { id: s.schoolId } });
    await signIn(page, s.ownerToken);
    await page.goto('/school');
    await expect(page.getByRole('heading', { level: 1, name: 'School profile' })).toBeVisible();
    await expect(page.locator('.u8n-page-header__subtitle')).toHaveText(school.name);
    await expect(page.getByTestId('school-join-code')).toBeVisible();
    await expectRoundButtons(main(page));
    const closeCard = main(page).locator('.ultm8-card', { has: page.getByRole('heading', { name: 'Close this School' }) });
    await expect(closeCard).toHaveClass(/u8o-card--danger/);
    // White cards with no old grey border.
    const border = await main(page).locator('.ultm8-card').first().evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(border).toBe('0px');
  });
});

test.describe('Franchises', () => {
  let franchiseId: string;
  let franchiseName: string;
  let token: string;
  const userIds: string[] = [];
  const schoolIds: string[] = [];

  test.beforeEach(async () => {
    const owner = await db.user.create({
      data: {
        id: randomUUID(),
        email: `org-look-e2e-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Fran',
        surname: 'Owner',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(owner.id);
    franchiseName = `Org Look Co ${randomUUID().slice(0, 8)}`;
    franchiseId = (await db.franchise.create({ data: { id: randomUUID(), name: franchiseName, feeModel: 'FLAT', activities: ['Jiu Jitsu'], addressCountry: 'GB' } })).id;
    await db.roleGrant.create({ data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: owner.id, franchiseId } });
    const member = await db.school.create({ data: { id: randomUUID(), name: 'Org Member Dojo', franchiseId } });
    schoolIds.push(member.id);
    token = signToken({ sub: owner.id, email: owner.email, grants: [{ role: 'FRANCHISE_OWNER', franchiseId, schoolId: null, branchId: null }] });
  });

  test.afterEach(async () => {
    await db.roleGrant.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { franchiseId }] } });
    await db.school.deleteMany({ where: { id: { in: schoolIds } } });
    await db.paymentAccount.deleteMany({ where: { franchiseId } });
    await db.franchise.deleteMany({ where: { id: franchiseId } });
    await db.notification.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    schoolIds.length = 0;
  });

  test('the list card: our own Fee model drop-down, tags, View details and Edit as pills', async ({ page }) => {
    await signIn(page, token);
    await page.goto('/franchises');
    const list = page.getByRole('region', { name: 'Franchises' });
    await expect(list.getByRole('combobox', { name: 'Fee model' })).toBeVisible();
    await expect(list.getByRole('textbox', { name: 'Activity' })).toBeVisible();
    await expect(list.locator('select')).toHaveCount(0);
    const row = page.getByRole('row', { name: new RegExp(franchiseName) });
    await expect(row.getByText('Jiu Jitsu', { exact: true })).toBeVisible();
    await expect(row.getByText('Flat', { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expectRoundButtons(list);
    await row.getByRole('button', { name: 'View details' }).click();
    await expect(page).toHaveURL(new RegExp(`/franchises/${franchiseId}$`));
  });

  test("a Franchise's page: ‹ Franchises, Overview, its cards with light headings, and a red-outlined Close card", async ({ page }) => {
    await signIn(page, token);
    await page.goto(`/franchises/${franchiseId}`);
    await expect(page.getByRole('heading', { level: 1, name: franchiseName })).toBeVisible();
    await expect(page.locator('.u8n-page-header__parent')).toHaveAttribute('href', '/franchises');
    await expect(page.locator('.u8n-page-header__parent')).toHaveText('‹ Franchises');
    await expect(page.getByTestId('franchise-overview-link')).toBeVisible();
    for (const title of ['Member Schools', 'Fee charges', 'Schools asking to join']) {
      await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
    }
    await expect(page.getByRole('row', { name: /Org Member Dojo/ }).getByText('Not billing yet')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Close this Franchise' })).toHaveClass(/u8o-card--danger/);
    await expectRoundButtons(main(page));

    await page.getByTestId('franchise-overview-link').click();
    await expect(page).toHaveURL(new RegExp(`/franchises/${franchiseId}/overview$`));
    await expect(page.locator('.u8n-page-header__parent')).toHaveAttribute('href', `/franchises/${franchiseId}`);
    await expect(page.getByRole('combobox', { name: 'Show' })).toBeVisible();
    await expect(main(page).locator('select')).toHaveCount(0);
  });
});
