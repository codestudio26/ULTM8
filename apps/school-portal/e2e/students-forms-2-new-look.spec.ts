import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { addBranch, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';
import { pickOption } from './team-helpers';

/**
 * The Students section's other pages in the new look (Decision 453), forms
 * group 2: Sign-ups (and its Approve / Reject dialogs), Attendance, Growth,
 * Import and Rosters. Look only: the same fields, checks and API calls, which
 * tablet-sign-ups.spec.ts and the API's own tests still cover.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.signUp.deleteMany({ where });
  await db.rosterMember.deleteMany({ where: { roster: where } });
  await db.roster.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

async function addSignUp(opts: { branchId?: string } = {}) {
  return db.signUp.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      branchId: opts.branchId ?? null,
      kind: 'MEMBER',
      firstName: 'Tess',
      surname: 'Tablet',
      dateOfBirth: new Date('1994-03-02'),
      email: `sign-up-${randomUUID()}@example.test`,
      heardFrom: 'Walked past',
    },
  });
}

async function fitsTheScreen(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

/** The new header: "Students", the page's own line, and the section's tabs. */
async function expectStudentsHeader(page: Page, current: string) {
  const header = page.locator('.u8n-page-header');
  await expect(header.getByRole('heading', { level: 1, name: 'Students' })).toBeVisible();
  await expect(header.getByRole('navigation', { name: 'Students sections' }).getByRole('link', { name: current })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.ultm8-page-header')).toHaveCount(0);
}

test('Sign-ups: the new header and tabs, a pill switch for the views, and the new Approve and Reject dialogs', async ({ page }) => {
  await addBranch(s, 'North');
  await addBranch(s, 'South');
  await addSignUp();
  await page.goto('/students/sign-ups');
  await expectStudentsHeader(page, 'Sign-ups (1)');
  const views = page.getByRole('tablist', { name: 'Sign-up lists' });
  await expect(views.getByRole('tab')).toHaveText(['Waiting', 'Rejected', 'Done']);
  await expect(views.getByRole('tab', { name: 'Waiting' })).toHaveAttribute('aria-selected', 'true');

  const card = page.getByTestId('sign-up').filter({ hasText: 'Tess Tablet' });
  await expect(card.getByRole('heading', { level: 2, name: 'Tess Tablet' })).toBeVisible();
  await expect(card).toContainText('Walked past');

  // Approve: a School-wide tablet at a School with branches asks for the home
  // branch, in the new look's drop-down; Approve waits for it.
  await card.getByRole('button', { name: 'Approve' }).click();
  const approve = page.getByRole('dialog');
  await expect(approve.locator('select')).toHaveCount(0);
  await expect(approve.locator('.ultm8-modal__actions').getByRole('button')).toHaveText(['Cancel', 'Approve']);
  await expect(approve.locator('.ultm8-modal__actions').getByRole('button', { name: 'Approve' })).toBeDisabled();
  await pickOption(approve, 'Home branch', 'North');
  await expect(approve.locator('.ultm8-modal__actions').getByRole('button', { name: 'Approve' })).toBeEnabled();
  // The pick counts as an edit: a click outside no longer closes it.
  await page.mouse.click(5, 5);
  await expect(approve).toBeVisible();
  await approve.getByRole('button', { name: 'Cancel' }).click();
  await expect(approve).toHaveCount(0);

  // Reject: its buttons in the band, Cancel first.
  await card.getByRole('button', { name: 'Reject' }).click();
  const reject = page.getByRole('dialog');
  await expect(reject.locator('.ultm8-modal__actions').getByRole('button')).toHaveText(['Cancel', 'Reject']);
  await reject.getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByTestId('sign-up')).toHaveCount(0);
  await views.getByRole('tab', { name: 'Rejected' }).click();
  await expect(views.getByRole('tab', { name: 'Rejected' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('sign-up').filter({ hasText: 'Tess Tablet' })).toContainText(/Rejected by/);
});

test('Attendance and Growth: the new header and tabs, the branch drop-down and a stat row', async ({ page }) => {
  await addBranch(s, 'North');
  await addBranch(s, 'South');
  await page.goto('/students/attendance');
  await expectStudentsHeader(page, 'Attendance');
  await expect(page.locator('.u8n-page-header').getByRole('button', { name: /Log attendance/ })).toBeVisible();
  await expect(page.getByTestId('attendance-check-ins')).toHaveText('0');
  await expect(page.locator('.u8b-stats .u8b-stat')).toHaveCount(3);
  await expect(page.locator('main select, .u8b select')).toHaveCount(0);
  await pickOption(page, 'Branch', 'North');
  await expect(page.getByRole('combobox', { name: 'Branch', exact: true }).locator('[data-shown="true"]')).toHaveText('North');
  await page.getByLabel('Leave out Trial, Visitor and Friend Pass check-ins').check();
  await expect(page.getByTestId('attendance-check-ins')).toHaveText('0');

  await page.goto('/students/growth');
  await expectStudentsHeader(page, 'Growth');
  await expect(page.getByTestId('growth-active')).toBeVisible();
  await expect(page.locator('.u8b-stats .u8b-stat')).toHaveCount(5);
  await expect(page.getByTestId('growth-chart').getByRole('listitem')).toHaveCount(12);
  await expect(page.getByRole('combobox', { name: 'Branch', exact: true })).toBeVisible();
});

test('Import: chapters, the kind as pills, a new-look file picker, and the results table', async ({ page }) => {
  await page.goto('/students/import');
  await expectStudentsHeader(page, 'Import');
  for (const chapter of ['What to import', 'Spreadsheet (CSV)']) {
    await expect(page.getByRole('heading', { level: 2, name: chapter, exact: true })).toBeVisible();
  }
  await expect(page.locator('.u8n-page select, .u8b select')).toHaveCount(0);
  const kinds = page.getByRole('group', { name: 'What to import' }).last();
  await expect(kinds.getByRole('button')).toHaveText(['Members', 'Memberships', 'Past attendance']);
  await expect(kinds.getByRole('button', { name: 'Members', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await kinds.getByRole('button', { name: 'Past attendance' }).click();
  await expect(kinds.getByRole('button', { name: 'Past attendance' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/One row per class someone came to/)).toBeVisible();
  await kinds.getByRole('button', { name: 'Members', exact: true }).click();

  const email = `import-${randomUUID()}@example.test`;
  await page.getByTestId('import-file').setInputFiles({
    name: 'members.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`first_name,last_name,email,date_of_birth\nIrene,Import,${email},1990-04-05\n`),
  });
  await page.getByRole('button', { name: 'Check the file' }).click();
  await expect(page.getByText('Nothing has been imported yet. Look through the rows, then import.')).toBeVisible();
  const results = page.getByTestId('import-results');
  await expect(results.getByRole('row').filter({ hasText: email })).toContainText('To import');
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  // Nothing was imported.
  expect(await db.user.count({ where: { email } })).toBe(0);
});

test('Rosters: the new header with "‹ Students", soft fields, the student drop-down and pill buttons', async ({ page }) => {
  await page.goto('/students/rosters');
  await expect(page.locator('.u8n-page-header').getByRole('link', { name: 'Students', exact: true })).toHaveAttribute('href', '/students');
  await expect(page.getByRole('heading', { level: 1, name: 'Rosters' })).toBeVisible();
  await page.getByLabel('New roster').fill('Competition team');
  await page.getByRole('button', { name: 'Add roster' }).click();
  // The new roster opens: its card, with the new look's drop-down to add a student.
  const members = page.locator('.u8b-card').filter({ has: page.getByRole('heading', { level: 2, name: 'Competition team' }) });
  await expect(members).toBeVisible();
  await expect(page.locator('.u8b select')).toHaveCount(0);
  await pickOption(members, 'Add a student', s.student.name);
  await members.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(members.getByRole('link', { name: s.student.name })).toBeVisible();
  await members.getByRole('button', { name: `Remove ${s.student.name} from this roster` }).click();
  await expect(members.getByRole('link', { name: s.student.name })).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('every page fits the screen; Import\'s results become cards', async ({ page }) => {
    await addBranch(s, 'North');
    await addBranch(s, 'South');
    await addSignUp();
    for (const path of ['/students/sign-ups', '/students/attendance', '/students/growth', '/students/import', '/students/rosters']) {
      await page.goto(path);
      await expect(page.locator('.u8n-page-header h1')).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await fitsTheScreen(page), path).toBe(true);
    }
    await page.goto('/students/import');
    const email = `import-${randomUUID()}@example.test`;
    await page.getByTestId('import-file').setInputFiles({
      name: 'members.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`first_name,last_name,email,date_of_birth\nIrene,Import,${email},1990-04-05\n`),
    });
    await page.getByRole('button', { name: 'Check the file' }).click();
    await expect(page.getByTestId('import-results')).toHaveAttribute('data-layout', 'cards');
    expect(await fitsTheScreen(page)).toBe(true);
  });
});
