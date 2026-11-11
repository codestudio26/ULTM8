import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The Students list in the new look (Decision 453; DESIGN.md → "Students
 * list: open full page from each row, panel never repeats the row"): each
 * row has "Open full page ›", and the right-hand panel shows the selected
 * student without repeating the row.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // Sam Lee (s.student) and Nia Park (s.newStudent)
});

test.afterAll(async () => {
  await cleanup();
});

const panel = (page: Page) => page.getByRole('complementary', { name: 'Student' });

test('picking a row shows that student in the panel, which leaves out what the row shows', async ({ page }) => {
  const north = await addBranch(s, 'North');
  await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, branchId: north.id } });
  const sam = await db.user.findUniqueOrThrow({ where: { id: s.student.id } });

  await signIn(page, s.ownerToken);
  await page.goto('/students');
  const samRow = page.getByRole('row', { name: /Sam Lee/ });
  await expect(samRow.getByRole('link', { name: 'Open full page: Sam Lee' })).toHaveAttribute('href', `/students/${s.student.id}`);

  await page.getByRole('button', { name: 'Sam Lee', exact: true }).click();
  await expect(samRow).toHaveAttribute('data-sel', 'true');
  await expect(panel(page).getByText('Sam Lee', { exact: true })).toBeVisible();
  await expect(panel(page).getByText(/^Student since /)).toBeVisible();
  await expect(panel(page).getByText('North', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('link', { name: 'Edit Sam Lee' })).toHaveAttribute('href', `/students/${s.student.id}/edit`);
  // Not repeated from the row: the status tag, the email and "Open full page".
  await expect(panel(page).getByText('Active', { exact: true })).toHaveCount(0);
  await expect(panel(page).getByText(sam.email)).toHaveCount(0);
  await expect(panel(page).getByRole('link', { name: /Open full page/ })).toHaveCount(0);

  // The round button picks a row too.
  await page.getByRole('button', { name: 'Show Nia Park' }).click();
  await expect(panel(page).getByText('Nia Park', { exact: true })).toBeVisible();
  await expect(panel(page).getByText('No home branch', { exact: true })).toBeVisible();
  await expect(samRow).toHaveAttribute('data-sel', 'false');

  await samRow.getByRole('link', { name: 'Open full page: Sam Lee' }).click();
  await expect(page).toHaveURL(new RegExp(`/students/${s.student.id}$`));
});

test('a coach sees the list and the panel read only: no Edit, Add or Invite', async ({ page }) => {
  const coach = await addPerson('Cora', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await signIn(page, coach.token);
  await page.goto('/students');
  await page.getByRole('button', { name: 'Sam Lee', exact: true }).click();
  await expect(panel(page).getByText('Sam Lee', { exact: true })).toBeVisible();
  await expect(panel(page).getByRole('link', { name: /^Edit / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add manually' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Invite a Student' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0);
});

test('the filter drop-downs are our own, and work by keyboard', async ({ page }) => {
  const north = await addBranch(s, 'North');
  await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, branchId: north.id } });
  await signIn(page, s.ownerToken);
  await page.goto('/students');
  await expect(page.getByRole('button', { name: 'Nia Park', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  const branch = page.getByRole('combobox', { name: 'Branch' });
  // Every option sits in the field to size it; only the chosen one shows.
  const shown = branch.locator('[data-shown="true"]');
  await expect(shown).toHaveText('All branches');
  await expect(page.locator('#students-filters select')).toHaveCount(0);
  await branch.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(shown).toHaveText('North');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sam Lee', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nia Park', exact: true })).toHaveCount(0);
  await expect(page.getByText('Showing 1 of 1')).toBeVisible();
});

test('the Rows / Grid switch is kept: Grid shows the same students as cards, Rows brings the table back', async ({ page }) => {
  const north = await addBranch(s, 'North');
  await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, branchId: north.id } });
  await signIn(page, s.ownerToken);
  await page.goto('/students');
  const view = page.getByRole('group', { name: 'Students view' });
  await expect(view.getByRole('button', { name: 'Rows' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page)).toBeVisible();

  await view.getByRole('button', { name: 'Grid' }).click();
  await expect(view.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('table')).toHaveCount(0);
  const card = page.getByRole('listitem').filter({ hasText: 'Sam Lee' });
  await expect(card.getByText('North', { exact: true })).toBeVisible();
  await expect(card.getByText('Active', { exact: true })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Nia Park' })).toBeVisible();
  // The panel goes with Rows; a card opens the full page, as before.
  await expect(panel(page)).toHaveCount(0);
  await expect(card.getByRole('link', { name: 'Sam Lee' })).toHaveAttribute('href', `/students/${s.student.id}`);

  await view.getByRole('button', { name: 'Rows' }).click();
  await expect(page.getByRole('row', { name: /Sam Lee/ })).toBeVisible();
  await expect(panel(page)).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('tapping a student shrinks the list to them, and Show all brings it back; Export is under More', async ({ page }) => {
    await signIn(page, s.ownerToken);
    await page.goto('/students');
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Nia Park', exact: true }).click();
    await expect(page.getByRole('row', { name: /Sam Lee/ })).toBeHidden();
    await expect(panel(page).getByText('Nia Park', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show all students (2)' }).click();
    await expect(page.getByRole('row', { name: /Sam Lee/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show all students (2)' })).toBeHidden();
  });
});
