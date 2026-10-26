import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Branches page filters. Decision 294: one search box (name, city or
 * postcode), a City dropdown built from the School's own Branches, and a
 * Country dropdown once a School is in more than one country, all ignoring
 * case and accents; every Branch loads, sorted A to Z. Downtown Toronto and
 * Vaughan Mills are older free-text addresses (no structured city).
 */
let s: GradingSchool;
const branchIds: string[] = [];

async function mkStructured(name: string, a: { line1: string; city: string; postalCode: string; country: string; address: string }) {
  const b = await db.branch.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      name,
      address: a.address,
      addressLine1: a.line1,
      addressCity: a.city,
      addressPostalCode: a.postalCode,
      addressCountry: a.country,
    },
  });
  branchIds.push(b.id);
}

test.beforeEach(async () => {
  s = await seedGradingSchool();
  const toronto = await db.branch.create({
    data: { id: randomUUID(), schoolId: s.schoolId, name: 'Downtown Toronto', address: '123 Main St, Toronto, ON' },
  });
  const vaughan = await db.branch.create({
    data: { id: randomUUID(), schoolId: s.schoolId, name: 'Vaughan Mills', address: '456 King St, Vaughan, ON' },
  });
  branchIds.push(toronto.id, vaughan.id);
});

test.afterEach(async () => {
  await db.branch.deleteMany({ where: { id: { in: branchIds } } });
  branchIds.length = 0;
});

test.afterAll(async () => {
  await cleanup();
});

test('the City dropdown matches the city only, not a street with the same name', async ({ page }) => {
  await mkStructured('London Central', { line1: '1 High Street', city: 'London', postalCode: 'SW1A 1AA', country: 'GB', address: '1 High Street, London, SW1A 1AA, United Kingdom' });
  await mkStructured('Manchester North', { line1: '22 London Road', city: 'Manchester', postalCode: 'M1 2AB', country: 'GB', address: '22 London Road, Manchester, M1 2AB, United Kingdom' });
  await signIn(page, s.ownerToken);
  await page.goto('/branches');

  const city = page.getByLabel('City');
  await expect(city.locator('option')).toHaveText(['All cities', 'London (1)', 'Manchester (1)']);
  await city.selectOption('London');

  // exact: true — the per-row "Actions for <name>" button sits in its own
  // cell alongside "Settings", whose accessible name contains the Branch name.
  await expect(page.getByRole('cell', { name: 'London Central', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Manchester North', exact: true })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Downtown Toronto', exact: true })).toHaveCount(0);

  await city.selectOption('');
  await expect(page.getByRole('cell', { name: 'Manchester North', exact: true })).toBeVisible();
});

test('search finds a name, a city without its accents, a postcode without spaces, and an older free-text address', async ({ page }) => {
  await mkStructured('Centro', { line1: 'Av. Paulista 1000', city: 'São Paulo', postalCode: '01310-100', country: 'BR', address: 'Av. Paulista 1000, São Paulo, 01310-100, Brazil' });
  await mkStructured('London Central', { line1: '1 High Street', city: 'London', postalCode: 'SW1A 1AA', country: 'GB', address: '1 High Street, London, SW1A 1AA, United Kingdom' });
  await signIn(page, s.ownerToken);
  await page.goto('/branches');
  const search = page.getByRole('searchbox', { name: 'Search', exact: true });
  const rows = page.locator('tbody tr');

  await search.fill('sao paulo');
  await expect(page.getByRole('cell', { name: 'Centro', exact: true })).toBeVisible();
  await expect(rows).toHaveCount(1);

  await search.fill('sw1a1aa');
  await expect(page.getByRole('cell', { name: 'London Central', exact: true })).toBeVisible();
  await expect(rows).toHaveCount(1);

  await search.fill('toronto');
  await expect(page.getByRole('cell', { name: 'Downtown Toronto', exact: true })).toBeVisible();
  await expect(rows).toHaveCount(1);

  await search.fill('%');
  await expect(page.getByText('No Branches match these filters')).toBeVisible();

  await search.fill('');
  await expect(rows).toHaveCount(4);
});

test('the Country dropdown appears once Branches are in two countries, and filters by it', async ({ page }) => {
  await mkStructured('London Central', { line1: '1 High Street', city: 'London', postalCode: 'SW1A 1AA', country: 'GB', address: '1 High Street, London, SW1A 1AA, United Kingdom' });
  await signIn(page, s.ownerToken);
  await page.goto('/branches');
  await expect(page.getByRole('cell', { name: 'London Central', exact: true })).toBeVisible();
  await expect(page.getByLabel('Country')).toHaveCount(0);

  await mkStructured('Centro', { line1: 'Av. Paulista 1000', city: 'São Paulo', postalCode: '01310-100', country: 'BR', address: 'Av. Paulista 1000, São Paulo, 01310-100, Brazil' });
  await page.reload();
  const country = page.getByLabel('Country');
  await expect(country.locator('option')).toHaveText(['All countries', 'Brazil', 'United Kingdom']);
  await country.selectOption('BR');
  await expect(page.getByRole('cell', { name: 'Centro', exact: true })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(1);
});

test('every Branch loads, sorted A to Z, even past 20', async ({ page }) => {
  for (let i = 1; i <= 23; i++) {
    const b = await db.branch.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: `Bulk ${String(i).padStart(2, '0')}`, address: `${i} Bulk Rd, Leeds` } });
    branchIds.push(b.id);
  }
  await signIn(page, s.ownerToken);
  await page.goto('/branches');

  const names = page.locator('tbody tr td:first-child');
  await expect(names).toHaveCount(25);
  await expect(names.first()).toHaveText('Bulk 01');
  await expect(names.last()).toHaveText('Vaughan Mills');
});

test('toggling to Grid view shows the same Branches as cards, and toggling back restores the table', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/branches');

  await expect(page.getByRole('table')).toBeVisible();
  // exact: true — see the other test's own comment above for why.
  await expect(page.getByRole('cell', { name: 'Downtown Toronto', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Vaughan Mills', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Grid' }).click();

  // The table is gone — the same two Branches now render as cards instead.
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByText('Downtown Toronto')).toBeVisible();
  await expect(page.getByText('123 Main St, Toronto, ON')).toBeVisible();
  await expect(page.getByText('Vaughan Mills')).toBeVisible();

  await page.getByRole('button', { name: 'Rows' }).click();

  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Downtown Toronto', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Vaughan Mills', exact: true })).toBeVisible();
});
