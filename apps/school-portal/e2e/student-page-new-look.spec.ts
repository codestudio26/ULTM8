import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { addBranch, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The student's full page in the new look (Decision 453; DESIGN-BRIEF §8
 * "Student profile"; DESIGN.md → "Student page: nothing shown twice"): a
 * "‹ Students" header with the name and two tabs, Profile and Ranks, white
 * cards with light header bars, and the summary panel on the right that
 * never repeats what the page shows.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // Sam Lee (s.student), White 1 in BJJ
});

test.afterAll(async () => {
  await cleanup();
});

const panel = (page: Page) => page.getByRole('complementary', { name: 'Student' });

test('the owner sees the header, the tabs, the cards and the summary panel', async ({ page }) => {
  const north = await addBranch(s, 'North');
  await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, branchId: north.id } });
  const phone = `+4477${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  await db.user.update({ where: { id: s.student.id }, data: { phone, dateOfBirth: new Date('1999-02-14'), gender: 'MALE' } });
  await signIn(page, s.ownerToken);
  await page.goto(`/students/${s.student.id}`);

  await expect(page.getByRole('heading', { level: 1, name: s.student.name })).toBeVisible();
  await expect(page.locator('.u8n-page-header').getByRole('link', { name: 'Students', exact: true })).toHaveAttribute('href', '/students');
  const tabs = page.getByRole('navigation', { name: 'Student sections' });
  await expect(tabs.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
  await expect(tabs.getByRole('link', { name: 'Ranks' })).not.toHaveAttribute('aria-current', 'page');

  // Profile: the cards, each with a light header bar.
  for (const name of ['Upcoming Booking', 'Memberships', 'Notes', 'Payments']) {
    await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('region', { name: 'BJJ' })).toHaveCount(0);

  // The summary panel: status, "Student since", Edit, the check-in code,
  // Contact, Personal, Training, Account and Tags. Not the name: the header has it.
  const p = panel(page);
  await expect(p.getByText('Active', { exact: true })).toBeVisible();
  await expect(p.getByText(/^Student since /)).toBeVisible();
  await expect(p.getByRole('link', { name: `Edit ${s.student.name}` })).toHaveAttribute('href', `/students/${s.student.id}/edit`);
  await expect(p.getByTestId('student-check-in-code')).toHaveText(/^\d+$/);
  await expect(p.getByRole('link', { name: phone })).toHaveAttribute('href', `tel:${phone}`);
  await expect(p.getByTestId('member-birthday')).toContainText(/years old/);
  await expect(p.getByTestId('member-gender')).toHaveText('Male');
  await expect(p.getByText('North', { exact: true })).toBeVisible();
  await expect(p.getByTestId('charge-balance')).toHaveText('Nothing owed');
  await expect(p.getByRole('region', { name: 'Tags' })).toBeVisible();
  await expect(p.getByText(s.student.name, { exact: true })).toHaveCount(0);

  // Nothing shown twice: the balance and the check-in code are only in the panel.
  await expect(page.getByTestId('charge-balance')).toHaveCount(1);
  await expect(page.getByTestId('student-check-in-code')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Edit profile' })).toHaveCount(0);

  // Nothing from the old look: no old cards or page header, no browser drop-down.
  await expect(page.locator('.ultm8-card')).toHaveCount(0);
  await expect(page.locator('.ultm8-page-header')).toHaveCount(0);
  await expect(page.locator('.u8sp select')).toHaveCount(0);

  // Ranks: the student's grading, one card per style.
  await tabs.getByRole('link', { name: 'Ranks' }).click();
  await expect(page).toHaveURL(new RegExp(`/students/${s.student.id}\\?tab=ranks$`));
  await expect(tabs.getByRole('link', { name: 'Ranks' })).toHaveAttribute('aria-current', 'page');
  const bjj = page.getByRole('region', { name: 'BJJ' });
  await expect(bjj.getByText('White 1', { exact: true })).toBeVisible();
  await expect(bjj.getByRole('button', { name: 'Grade' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Notes', exact: true })).toHaveCount(0);
  // The panel stays on both tabs.
  await expect(panel(page).getByTestId('student-check-in-code')).toBeVisible();
  await expect(page.locator('.u8sp select')).toHaveCount(0);
});

test('"On the Grading Board" is our own drop-down, and saves', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto(`/students/${s.student.id}?tab=ranks`);
  const field = page.getByRole('combobox', { name: 'Currently attending BJJ' });
  await expect(field.locator('[data-shown="true"]')).toHaveText('Active if they have a membership');
  await field.click();
  await page.getByRole('option', { name: 'Active (set by hand)', exact: true }).click();
  await expect(field.locator('[data-shown="true"]')).toHaveText('Active (set by hand)');
  await expect
    .poll(async () => (await db.studentRank.findFirstOrThrow({ where: { studentId: s.student.id } })).boardActiveOverride)
    .toBe(true);
});

test('a coach comes back to the Grading Board, and has no Edit', async ({ page }) => {
  const coach = await addPerson('Cora', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await signIn(page, coach.token);
  await page.goto(`/students/${s.student.id}`);
  await expect(page.getByRole('heading', { level: 1, name: s.student.name })).toBeVisible();
  await expect(page.locator('.u8n-page-header').getByRole('link', { name: 'Grading Board', exact: true })).toHaveAttribute('href', '/grading');
  await expect(panel(page).getByRole('link', { name: /^Edit / })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Student sections' }).getByRole('link', { name: 'Ranks' }).click();
  // A coach with no grading permissions is told so on the Ranks tab.
  await expect(page.getByText("The School owner hasn't given you grading in any style yet.")).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the cards come first, the summary panel below them, with no sideways scroll', async ({ page }) => {
    await signIn(page, s.ownerToken);
    await page.goto(`/students/${s.student.id}`);
    const notes = page.getByRole('region', { name: 'Notes', exact: true });
    await expect(notes).toBeVisible();
    const p = panel(page);
    await expect(p.getByTestId('student-check-in-code')).toBeVisible();
    const notesBox = (await notes.boundingBox())!;
    const panelBox = (await p.boundingBox())!;
    expect(panelBox.y).toBeGreaterThan(notesBox.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.getByRole('navigation', { name: 'Student sections' }).getByRole('link', { name: 'Ranks' }).click();
    await expect(page.getByRole('region', { name: 'BJJ' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
