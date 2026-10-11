import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * v1.2 backend backlog, "Classes page" — the Discipline filter + "Search
 * classes" box are now real server-side filters (GET
 * /schools/:schoolId/classes?activities=&search=) instead of filtering an
 * already-fully-fetched list client-side, and a Prev/Next pager is now wired to
 * the already-real ClassListResponseDto.nextCursor.
 */
let s: GradingSchool;
const classIds: string[] = [];

function classRow(title: string, activities: string[]) {
  return {
    id: randomUUID(),
    schoolId: s.schoolId,
    title,
    activities,
    startDate: new Date('2026-11-01T10:00:00.000Z'),
    endDate: new Date('2026-11-01T11:00:00.000Z'),
  };
}

test.beforeEach(async () => {
  s = await seedGradingSchool();
  const judo = await db.class.create({ data: classRow('Adult Judo Fundamentals', ['Judo']) });
  const bjj = await db.class.create({ data: classRow('Kids BJJ', ['BJJ']) });
  classIds.push(judo.id, bjj.id);
});

test.afterEach(async () => {
  await db.class.deleteMany({ where: { id: { in: classIds } } });
  classIds.length = 0;
});

test.afterAll(async () => {
  await cleanup();
});

test('Discipline and Search filters narrow the Classes list server-side', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/classes');

  await expect(page.getByRole('cell', { name: 'Adult Judo Fundamentals' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Kids BJJ' })).toBeVisible();

  await page.getByLabel('Discipline').fill('Judo');
  await expect(page.getByRole('cell', { name: 'Adult Judo Fundamentals' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Kids BJJ' })).toHaveCount(0);

  await page.getByLabel('Discipline').fill('');
  await page.getByLabel('Search classes').fill('kids');
  await expect(page.getByRole('cell', { name: 'Kids BJJ' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Adult Judo Fundamentals' })).toHaveCount(0);
});

test('Prev/Next pages through Classes, and Prev returns to the first page', async ({ page }) => {
  // The default server-side page size is 20 (PaginationQueryDto) — 21 Classes
  // tagged with their own unique discipline guarantees a real second page
  // without the UI needing a `limit` control of its own.
  const pagerClasses = await Promise.all(
    Array.from({ length: 21 }, (_, i) => db.class.create({ data: classRow(`Pager Class ${i}`, ['PagerFixture']) })),
  );
  classIds.push(...pagerClasses.map((c) => c.id));

  await signIn(page, s.ownerToken);
  await page.goto('/classes');
  await page.getByLabel('Discipline').fill('PagerFixture');

  await expect(page.getByText('Page 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prev' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();

  const firstPageFirstRow = await page.getByRole('row', { name: /Pager Class/ }).first().textContent();

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Page 2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prev' })).toBeEnabled();

  await page.getByRole('button', { name: 'Prev' }).click();
  await expect(page.getByText('Page 1')).toBeVisible();
  const backOnFirstPage = await page.getByRole('row', { name: /Pager Class/ }).first().textContent();
  expect(backOnFirstPage).toBe(firstPageFirstRow);
});
