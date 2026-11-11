import { randomUUID, createHmac } from 'crypto';
import { expect, test } from '@playwright/test';
import { db } from './fixtures';

/**
 * Decision 450 item 1 — the Franchise owner's read-only overview of its member
 * Schools' totals, reached from the Franchise page. Revenue stays per
 * currency; the owner can look at the whole Franchise or one School; a
 * member School's owner can't open it. Against the real API and Postgres.
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

const signInAs = (page: import('@playwright/test').Page, token: string) =>
  page.addInitScript((t) => sessionStorage.setItem('ultm8.accessToken', t), token);

let franchiseId: string;
let ownerToken: string;
let schoolOwnerToken: string;
const schoolIds: string[] = [];
const userIds: string[] = [];

async function mkUser(label: string) {
  const user = await db.user.create({
    data: {
      id: randomUUID(),
      email: `franchise-overview-e2e-${label}-${randomUUID()}@example.test`,
      phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
      firstName: `Member${label}`,
      surname: 'Overview',
      passcodeHash: 'x',
      dateOfBirth: new Date('1990-01-01'),
      phoneVerifiedAt: new Date(),
    },
  });
  userIds.push(user.id);
  return user;
}

/** A member School with one active student and one payment in `currency`. */
async function seedSchool(name: string, currency: string, amount: number) {
  const school = await db.school.create({ data: { id: randomUUID(), name, franchiseId, timezone: 'UTC' } });
  schoolIds.push(school.id);
  const student = await mkUser(name.replace(/\W/g, ''));
  await db.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id } });
  const plan = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Monthly', price: amount } });
  await db.membership.create({
    data: { id: randomUUID(), studentId: student.id, membershipPlanId: plan.id, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING' },
  });
  const account = await db.paymentAccount.create({ data: { id: randomUUID(), schoolId: school.id, provider: 'CASH', accountTitle: 'Desk', country: 'GB' } });
  await db.transaction.create({
    data: {
      id: randomUUID(), schoolId: school.id, studentId: student.id, paymentAccountId: account.id, paymentMethod: 'CASH',
      kind: 'MEMBERSHIP', amount, currency, status: 'SUCCESSFUL',
    },
  });
  return { school, student };
}

test.beforeEach(async () => {
  const owner = await mkUser('fowner');
  franchiseId = (await db.franchise.create({ data: { id: randomUUID(), name: `Overview Co ${randomUUID().slice(0, 8)}` } })).id;
  await db.roleGrant.create({ data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: owner.id, franchiseId } });
  ownerToken = signToken({ sub: owner.id, email: owner.email, grants: [{ role: 'FRANCHISE_OWNER', franchiseId, schoolId: null, branchId: null }] });

  const { school } = await seedSchool('Overview North', 'USD', 5000);
  await seedSchool('Overview South', 'BRL', 12000);
  const schoolOwner = await mkUser('sowner');
  await db.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: schoolOwner.id, schoolId: school.id, isMainOwner: true } });
  schoolOwnerToken = signToken({ sub: schoolOwner.id, email: schoolOwner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });
});

test.afterEach(async () => {
  const where = { schoolId: { in: schoolIds } };
  await db.transaction.deleteMany({ where });
  await db.paymentAccount.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
  await db.studentJoinDate.deleteMany({ where });
  await db.staffPermission.deleteMany({ where });
  await db.roleGrant.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { franchiseId }, where] } });
  await db.school.deleteMany({ where: { id: { in: schoolIds } } });
  await db.franchise.deleteMany({ where: { id: franchiseId } });
  await new Promise((r) => setTimeout(r, 500));
  await db.notification.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  schoolIds.length = 0;
  userIds.length = 0;
});

test.afterAll(async () => {
  await db.$disconnect();
});

test('the Franchise owner opens the overview: totals, revenue per currency, and one School at a time', async ({ page }) => {
  await signInAs(page, ownerToken);
  await page.goto(`/franchises/${franchiseId}`);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/franchises/${franchiseId}/overview$`));
  await expect(page.getByTestId('overview-totals-only')).toContainText('Totals only.');

  await expect(page.getByTestId('overview-active')).toHaveText('2');
  await expect(page.getByTestId('overview-enrolled')).toHaveText('2');
  // Two currencies, two lines: never added together.
  const revenue = page.getByTestId('overview-revenue');
  await expect(revenue.getByRole('row', { name: /BRL/ })).toContainText('120.00 BRL');
  await expect(revenue.getByRole('row', { name: /USD/ })).toContainText('50.00 USD');
  const schools = page.getByTestId('overview-schools');
  await expect(schools.getByRole('row', { name: /Overview North/ })).toContainText('50.00 USD');
  await expect(schools.getByRole('row', { name: /Overview South/ })).toContainText('120.00 BRL');
  // No member's name anywhere on the page.
  await expect(page.getByText(/MemberOverview/)).toHaveCount(0);

  // Our own drop-down (DESIGN.md → "Drop-downs"), not the browser's.
  await page.getByRole('combobox', { name: 'Show' }).click();
  await page.getByRole('listbox', { name: 'Show' }).getByRole('option', { name: 'Overview North' }).click();
  await expect(page.getByTestId('overview-active')).toHaveText('1');
  await expect(page.getByTestId('overview-revenue').getByRole('row', { name: /BRL/ })).toHaveCount(0);
  await expect(page.getByTestId('overview-schools')).toHaveCount(0);
});

test("a member School's owner can't open the Franchise overview", async ({ page }) => {
  await signInAs(page, schoolOwnerToken);
  await page.goto(`/franchises/${franchiseId}/overview`);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('overview-active')).toHaveCount(0);
  await expect(page.getByTestId('overview-revenue')).toHaveCount(0);
});
