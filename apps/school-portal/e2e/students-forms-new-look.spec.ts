import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { addBranch, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';
import { pickOption } from './team-helpers';

/**
 * The Students forms in the new look (Decision 453): Add student, Edit and
 * Invite in form pattern "F" (DESIGN.md), and the Students dialogs in the
 * shared new-look dialog. Look only: the same fields, checks and API calls,
 * which the Students specs (students-review-fixes, student-access,
 * invite-student, student-export) still cover.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

async function removeAccount(email: string) {
  const user = await db.user.findUnique({ where: { email } });
  if (!user) return;
  await db.notification.deleteMany({ where: { userId: user.id } });
  await db.waiverSignature.deleteMany({ where: { studentId: user.id } });
  await db.studentHomeBranch.deleteMany({ where: { studentId: user.id } });
  await db.roleGrant.deleteMany({ where: { userId: user.id } });
  await db.user.delete({ where: { id: user.id } });
}

test('Add student is numbered chapters with a live preview, "Ready to save" and the Add button in the panel', async ({ page }) => {
  await addBranch(s, 'North');
  const email = `forms-${randomUUID()}@example.test`;
  try {
    await page.goto('/students/add');
    await expect(page.locator('.u8n-page-header').getByRole('link', { name: 'Students', exact: true })).toHaveAttribute('href', '/students');
    await expect(page.getByRole('heading', { level: 1, name: 'Add a Student manually' })).toBeVisible();
    // No browser drop-downs left on the form.
    await expect(page.locator('.u8n-page select')).toHaveCount(0);

    const personal = page.getByRole('group', { name: 'Personal details' });
    const panel = page.getByRole('complementary', { name: 'New student' });
    const item = (label: string) => panel.getByRole('listitem').filter({ hasText: label });
    await expect(panel.getByText('Details appear as you type')).toBeVisible();
    await expect(item('Name')).not.toHaveClass(/ultm8-checklist__item--done/);
    await expect(item('Home branch')).toBeVisible();

    await personal.getByLabel('First name').fill('Ada');
    await personal.getByLabel('Surname').fill('Lovelace');
    // The preview card mirrors what is typed.
    await expect(panel.getByText('Ada Lovelace')).toBeVisible();
    await expect(item('Name')).toHaveClass(/ultm8-checklist__item--done/);
    await personal.getByLabel('Date of birth').fill('1990-05-01');
    await expect(panel.getByText(/^Born /)).toBeVisible();
    await personal.getByLabel('Email').fill(email);
    // The chapter is done only once the branch is chosen too.
    await expect(page.locator('.ultm8-chapter--done')).toHaveCount(0);
    await pickOption(personal, 'Home branch', 'North');
    await expect(page.locator('.ultm8-chapter--done')).toHaveCount(1);
    await expect(personal.getByText('Done', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Personal details\s*Done/ })).toBeVisible();

    await panel.getByRole('button', { name: 'Add Student' }).click();
    await expect(page.getByText('Ada Lovelace has been added.')).toBeVisible();
    await expect(page.getByTestId('temporary-passcode')).toHaveText(/^\d{6}$/);
  } finally {
    await removeAccount(email);
  }
});

test('Edit a student is in chapters, with Gender as pills and Language as the new look\'s drop-down', async ({ page }) => {
  await page.goto(`/students/${s.newStudent.id}/edit`);
  for (const chapter of ['Personal details', 'Address', 'Other contacts', 'Sizes']) {
    await expect(page.getByRole('heading', { level: 2, name: chapter, exact: true })).toBeVisible();
  }
  const gender = page.getByRole('group', { name: 'Gender' });
  await expect(gender.getByRole('button')).toHaveText(['Not set', 'Female', 'Male']);
  await expect(page.getByRole('group', { name: 'Personal details' }).getByRole('combobox', { name: 'Language', exact: true })).toBeVisible();
  // The size hint is said once, under the chapter's title.
  await expect(page.getByText('Free text — no unit or size chart has been agreed yet.')).toHaveCount(1);
});

test('a drop-down pick in a dialog counts as an edit: an outside click no longer closes it', async ({ page }) => {
  await page.goto('/students');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export students' });
  // Untouched, a click outside closes it, as before.
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(dialog.locator('select')).toHaveCount(0);
  await pickOption(dialog, 'Students', 'Active and former');
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  // Its buttons sit in the band at its foot, Cancel first.
  await expect(dialog.locator('.ultm8-modal__actions').getByRole('button')).toHaveText(['Cancel', 'Print', 'Download CSV']);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Add student fits the screen, one field per row, with the panel below the form', async ({ page }) => {
    await page.goto('/students/add');
    await expect(page.getByRole('group', { name: 'Personal details' })).toBeVisible();
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(fits).toBe(true);
    const first = await page.getByLabel('First name').boundingBox();
    const surname = await page.getByLabel('Surname').boundingBox();
    expect(surname!.y).toBeGreaterThan(first!.y);
    const form = await page.locator('#add-student-form').boundingBox();
    const panel = await page.getByRole('complementary', { name: 'New student' }).boundingBox();
    expect(panel!.y).toBeGreaterThan(form!.y + form!.height - 1);
  });
});
