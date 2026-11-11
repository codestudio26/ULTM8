import { randomUUID } from 'crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { addStudent, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';
import { pickOption } from './team-helpers';

/**
 * The board and student grading dialogs in the new look (Decisions 453, 460):
 * the Ranks tab's Grade, Move down, Correct date, Verify, Log a class, Void,
 * Edit note and Note changes, and the board's Move, Board columns, Promote
 * these students (with its done step) and "Promote {name}?". Each sits in the
 * shared dialog frame with its buttons in the band at its foot, Cancel first,
 * and no browser drop-down is left. Look only: the grading rules, checks and
 * API calls are the same, and grading-board, board-thresholds, student-ranks,
 * student-grading, kids-adult-programs and promotion-fee-charges still cover
 * them.
 *
 * Seed: BJJ, White 0 → White 1 → White 2 → Blue 0; Sam Lee holds White 1
 * with 3 of 3 classes and the Armbar skill not signed off.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterEach(async () => {
  await db.class.deleteMany({ where: { schoolId: s.schoolId } });
});

test.afterAll(async () => {
  await cleanup();
});

const bjj = (page: Page) => page.getByRole('region', { name: 'BJJ' });

/** A dialog in the new look: no browser drop-down, and its buttons in the band at its foot. */
async function expectNewLook(dialog: Locator, buttons: string[]) {
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('select')).toHaveCount(0);
  await expect(dialog.locator('.ultm8-modal__actions').getByRole('button')).toHaveText(buttons);
}

test('the Ranks tab dialogs: the button band, Cancel first, and no browser drop-down', async ({ page }) => {
  await db.studentRank.updateMany({ where: { studentId: s.student.id }, data: { verificationStatus: 'UNVERIFIED' } });
  await page.goto(`/students/${s.student.id}?tab=ranks`);
  const card = bjj(page);

  await card.getByRole('button', { name: 'Verify rank' }).click();
  const verify = page.getByRole('dialog', { name: 'Verify rank — BJJ' });
  await expectNewLook(verify, ['Cancel', 'Verify']);
  await verify.getByRole('button', { name: 'Cancel' }).click();
  await expect(verify).toHaveCount(0);

  // White 1 → White 2 is the next stripe; the missing skill still needs the acknowledgement.
  await card.getByRole('button', { name: 'Grade', exact: true }).click();
  const grade = page.getByRole('dialog', { name: 'Grade — BJJ' });
  await expectNewLook(grade, ['Cancel', 'Award stripe']);
  await expect(grade.getByRole('button', { name: 'Award stripe' })).toBeDisabled();
  await grade.getByRole('button', { name: 'Cancel' }).click();

  await card.getByRole('button', { name: 'Move down' }).click();
  const down = page.getByRole('dialog', { name: 'Move down — BJJ' });
  await expectNewLook(down, ['Cancel', 'Move down']);
  await down.getByRole('button', { name: 'Cancel' }).click();

  await card.getByRole('button', { name: 'Correct date' }).click();
  const date = page.getByRole('dialog', { name: 'Correct rank date — BJJ' });
  await expectNewLook(date, ['Cancel', 'Save date']);
  await date.getByRole('button', { name: 'Cancel' }).click();

  // Log a class: the band is the form's last row, so Enter in a field submits it.
  await card.getByRole('button', { name: 'Log a class' }).click();
  const log = page.getByRole('dialog', { name: 'Log a class — BJJ' });
  await expectNewLook(log, ['Cancel', 'Log class']);
  await log.getByLabel('Time on the mat (minutes)').press('Enter');
  await expect(log).toHaveCount(0);
  await expect(card.getByText(/Class logged by hand/)).toBeVisible();

  await card.getByRole('button', { name: /^Add note: / }).first().click();
  const note = page.getByRole('dialog', { name: 'Edit note' });
  await expectNewLook(note, ['Cancel', 'Save note']);
  await note.getByLabel('Note').fill('Good round');
  await note.getByRole('button', { name: 'Save note' }).click();
  await expect(note).toHaveCount(0);

  await card.getByRole('button', { name: /^Note changes: / }).first().click();
  const changes = page.getByRole('dialog', { name: 'Note changes' });
  await expectNewLook(changes, ['Close']);
  await changes.getByRole('button', { name: 'Close' }).click();

  await card.getByRole('button', { name: /^Void entry: / }).first().click();
  const voidIt = page.getByRole('dialog', { name: 'Void history entry' });
  await expectNewLook(voidIt, ['Cancel', 'Void entry']);
  await voidIt.getByRole('button', { name: 'Cancel' }).click();
  await expect(voidIt).toHaveCount(0);
});

test('Log a class: "Class" and "No class" are still radio buttons, drawn as pills; changing one is an edit', async ({ page }) => {
  await db.class.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      title: 'Adult Fundamentals',
      activities: ['BJJ'],
      styles: [{ disciplineId: s.disciplineId, classType: null }],
      startDate: new Date(Date.now() - 26 * 3_600_000),
      endDate: new Date(Date.now() - 24.5 * 3_600_000),
    },
  });
  await page.goto(`/students/${s.student.id}?tab=ranks`);
  await bjj(page).getByRole('button', { name: 'Log a class' }).click();
  const log = page.getByRole('dialog', { name: 'Log a class — BJJ' });
  await expect(log.getByRole('combobox', { name: 'Class', exact: true })).toBeVisible();
  const noClass = log.getByRole('radio', { name: 'No class (enter the time)' });
  await expect(noClass).not.toBeChecked();
  // The radio covers its whole pill, so a tap anywhere on the pill picks it.
  await noClass.click();
  await expect(noClass).toBeChecked();
  await expect(log.getByLabel('Time on the mat (minutes)')).toHaveValue('60');
  // An edit: a click outside no longer closes the dialog.
  await page.mouse.click(5, 5);
  await expect(log).toBeVisible();
  await log.getByRole('button', { name: 'Cancel' }).click();
  await expect(log).toHaveCount(0);
});

test('"Promote {name}?" after a cancelled fee: the button band, Not now first', async ({ page }) => {
  await db.school.update({ where: { id: s.schoolId }, data: { promotionFeeEnabled: true, defaultCurrency: 'GBP' } });
  await db.promotionFeeRequest.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      studentId: s.student.id,
      disciplineId: s.disciplineId,
      toRungId: s.rung['White 2'].id,
      toRungName: 'White 2',
      expectedCurrentRungId: s.rung['White 1'].id,
      amountMinor: 4000,
      currency: 'GBP',
      status: 'PENDING',
      promotionWaits: true,
    },
  });
  await page.goto(`/students/${s.student.id}?tab=ranks`);
  await bjj(page).getByRole('region', { name: 'Promotion fee', exact: true }).getByRole('button', { name: 'Cancel fee' }).click();
  const decide = page.getByRole('dialog', { name: 'Promote Sam Lee?' });
  await expectNewLook(decide, ['Not now', 'Promote to White 2']);
  await expect(decide.getByText('The fee for White 2 was cancelled.')).toBeVisible();
  await decide.getByRole('button', { name: 'Not now' }).click();
  await expect(decide).toHaveCount(0);
});

test.describe('the board', () => {
  let ben: { id: string; name: string };

  test.beforeEach(async () => {
    ben = await addStudent(s, 'Ben', 'Ortiz', { rung: 'White 0', classes: 0, activeOverride: true });
  });

  test('Move: the new look\'s drop-down, a pick counts as an edit, and the band', async ({ page }) => {
    await page.goto('/grading');
    const openMove = () => page.getByRole('listitem', { name: ben.name }).getByRole('button', { name: `Move ${ben.name} to another column` }).click();
    await openMove();
    const move = page.getByRole('dialog', { name: `Move ${ben.name}` });
    await expectNewLook(move, ['Cancel', 'Move']);
    // Untouched, a click outside closes it, as before.
    await page.mouse.click(5, 5);
    await expect(move).toHaveCount(0);

    await openMove();
    await pickOption(move, 'Move to', 'Ready to Grade');
    // A pick is an edit, as the browser drop-down's change was: a click outside keeps it.
    await page.mouse.click(5, 5);
    await expect(move).toBeVisible();
    await move.getByRole('button', { name: 'Move' }).click();
    await expect(move).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Ready to Grade' }).getByRole('link', { name: ben.name })).toBeVisible();
  });

  test('Board columns: Cancel, Back to 33% / 66%, then Save', async ({ page }) => {
    await page.goto('/grading');
    await page.getByRole('button', { name: 'Change %' }).click();
    const dialog = page.getByRole('dialog', { name: 'Board columns — BJJ' });
    await expectNewLook(dialog, ['Cancel', 'Back to 33% / 66%', 'Save']);
    await dialog.getByLabel('"Getting There" from (%)').fill('50');
    await dialog.getByRole('button', { name: 'Back to 33% / 66%' }).click();
    await expect(dialog.getByLabel('"Getting There" from (%)')).toHaveValue('33');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('Promote these students and Students promoted: the band on each step', async ({ page }) => {
    await page.goto('/grading');
    await page.getByLabel(`Select ${ben.name}`).check();
    await page.getByRole('button', { name: 'Promote selected' }).click();
    const dialog = page.getByRole('dialog', { name: 'Promote these students' });
    await expectNewLook(dialog, ['Cancel', 'Promote 1 student']);
    await expect(dialog.getByRole('combobox', { name: `Promote ${ben.name} to` })).toBeVisible();
    await dialog.getByRole('button', { name: 'Promote 1 student' }).click();

    const done = page.getByRole('dialog', { name: 'Students promoted' });
    await expectNewLook(done, ['Open printable report', 'Done']);
    await done.getByRole('button', { name: 'Done' }).click();
    await expect(done).toHaveCount(0);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a grading dialog fills the screen and its button band stays in view', async ({ page }) => {
    await page.goto(`/students/${s.student.id}?tab=ranks`);
    await bjj(page).getByRole('button', { name: 'Grade', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Grade — BJJ' });
    await expect(dialog).toBeVisible();
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(fits).toBe(true);
    const band = await dialog.locator('.ultm8-modal__actions').boundingBox();
    expect(band!.y + band!.height).toBeLessThanOrEqual(844 + 1);
    expect(band!.width).toBeGreaterThan(300);
  });
});
