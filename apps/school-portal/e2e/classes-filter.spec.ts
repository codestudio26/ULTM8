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

  // `exact: true` — the row's kebab trigger now carries an `aria-label` of
  // "Actions for <title>", which (per the accessible-name-from-content
  // algorithm) makes the whole Actions `<td>`'s own accessible name contain
  // the title too, so a plain substring match on the title would also hit
  // that cell.
  await expect(page.getByRole('cell', { name: 'Adult Judo Fundamentals', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Kids BJJ', exact: true })).toBeVisible();

  await page.getByLabel('Discipline').fill('Judo');
  await expect(page.getByRole('cell', { name: 'Adult Judo Fundamentals', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Kids BJJ', exact: true })).toHaveCount(0);

  await page.getByLabel('Discipline').fill('');
  await page.getByLabel('Search classes').fill('kids');
  await expect(page.getByRole('cell', { name: 'Kids BJJ', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Adult Judo Fundamentals', exact: true })).toHaveCount(0);
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

/**
 * Redesign (post v1.2 backend backlog): the row's 4 always-visible action
 * buttons ("View bookings"/"Show QR"/"Roll call"/"Edit") are now collapsed
 * behind a per-row "⋮" kebab menu — same actions, same handlers, just hidden
 * until opened.
 */
test('the kebab menu reveals a row\'s actions, and each one still works', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/classes');

  const row = page.getByRole('row', { name: /Adult Judo Fundamentals/ });
  const trigger = row.getByRole('button', { name: 'Actions for Adult Judo Fundamentals' });
  await expect(trigger).toBeVisible();

  // Not shown until the kebab is opened.
  await expect(page.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0);

  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Actions for Adult Judo Fundamentals' });
  await expect(menu.getByRole('menuitem', { name: 'View bookings' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Show QR' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Roll call' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Edit' })).toBeVisible();

  // Escape closes it without triggering anything.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // The "Edit" action still opens the same edit modal as before.
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit class' })).toBeVisible();
});
