import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { createHmac, randomBytes } from 'crypto';
import { cleanup, db, signIn } from './fixtures';

/**
 * v1.2 backend backlog, "Franchises page" — the Fee model / Activity filters,
 * now real server-side filters (GET /franchises?feeModel=&activity=) instead of
 * filtering an already-fetched list client-side; and the Rows-table Name/logo
 * cell now navigates to the Franchise detail page itself, not only the row
 * action menu's "View details" button.
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

let ownerId: string;
let ownerToken: string;
const franchiseIds: string[] = [];

test.beforeEach(async () => {
  const owner = await db.user.create({
    data: {
      id: randomUUID(),
      email: `franchises-filter-e2e-${randomUUID()}@example.test`,
      phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
      firstName: 'Fran',
      surname: 'Owner',
      passcodeHash: 'x',
      dateOfBirth: new Date('1990-01-01'),
      phoneVerifiedAt: new Date(),
    },
  });
  ownerId = owner.id;

  const flat = await db.franchise.create({
    data: { id: randomUUID(), name: 'Flat Jiu Jitsu Co', feeModel: 'FLAT', activities: ['Jiu Jitsu'] },
  });
  const headcount = await db.franchise.create({
    data: { id: randomUUID(), name: 'Headcount Karate Co', feeModel: 'PER_HEADCOUNT', activities: ['Karate'] },
  });
  franchiseIds.push(flat.id, headcount.id);
  await db.roleGrant.createMany({
    data: [
      { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: owner.id, franchiseId: flat.id },
      { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: owner.id, franchiseId: headcount.id },
    ],
  });

  ownerToken = signToken({
    sub: owner.id,
    email: owner.email,
    grants: [
      { role: 'FRANCHISE_OWNER', franchiseId: flat.id, schoolId: null, branchId: null },
      { role: 'FRANCHISE_OWNER', franchiseId: headcount.id, schoolId: null, branchId: null },
    ],
  });
});

test.afterEach(async () => {
  await db.roleGrant.deleteMany({ where: { franchiseId: { in: franchiseIds } } });
  await db.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
  await db.user.deleteMany({ where: { id: ownerId } });
  franchiseIds.length = 0;
});

test.afterAll(async () => {
  await cleanup();
});

test('Fee model and Activity filters narrow the Franchises list server-side', async ({ page }) => {
  await signIn(page, ownerToken);
  await page.goto('/franchises');

  await expect(page.getByRole('cell', { name: 'Flat Jiu Jitsu Co' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Headcount Karate Co' })).toBeVisible();

  await page.getByLabel('Fee model').selectOption('PER_HEADCOUNT');
  await expect(page.getByRole('cell', { name: 'Headcount Karate Co' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Flat Jiu Jitsu Co' })).toHaveCount(0);

  await page.getByLabel('Fee model').selectOption('');
  await page.getByLabel('Activity').fill('Jiu Jitsu');
  await expect(page.getByRole('cell', { name: 'Flat Jiu Jitsu Co' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Headcount Karate Co' })).toHaveCount(0);
});

test('clicking the Name cell navigates to the Franchise detail page, same as "View details"', async ({ page }) => {
  await signIn(page, ownerToken);
  await page.goto('/franchises');

  await page.getByRole('button', { name: 'Flat Jiu Jitsu Co' }).click();
  await expect(page).toHaveURL(/\/franchises\/[\w-]+$/);
  await expect(page.getByRole('heading', { name: 'Flat Jiu Jitsu Co' })).toBeVisible();
});
