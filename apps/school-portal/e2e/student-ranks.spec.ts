import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The student's Ranks tab (DESIGN.md → "Hours trained: logged, not graded"
 * and "Promotion fee"): the Breakdown per requirement, hours trained, the new
 * "Log a class" dialog (a class, or the time on the mat) and the fee box.
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
const logs = () => db.trainingLog.findMany({ where: { studentId: s.student.id }, orderBy: { createdAt: 'asc' } });
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

async function logMinutes(minutes: number, trainedAt: Date) {
  await db.trainingLog.create({
    data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, disciplineId: s.disciplineId, minutes, source: 'LOGGED', trainedAt },
  });
}

test('the Breakdown shows each requirement, what is in the %, and hours trained as a record only', async ({ page }) => {
  await logMinutes(90, hoursAgo(24));
  await logMinutes(30, new Date(Date.now() - 90 * 86_400_000)); // before the current rank
  await page.goto(`/students/${s.student.id}`);
  const breakdown = bjj(page).getByRole('region', { name: 'Breakdown' });
  const classes = breakdown.getByRole('listitem', { name: 'Classes: 3 of 3' });
  await expect(classes.getByText('Counts toward the %')).toBeVisible();
  await expect(classes.getByText('100%')).toBeVisible();
  const skills = breakdown.getByRole('listitem', { name: 'Skills signed off: 0 of 1' });
  await expect(skills.getByText('Needed too, not in the %')).toBeVisible();
  await expect(breakdown.getByRole('listitem', { name: /^Days at this rank:/ })).toBeVisible();

  const hours = bjj(page).getByRole('region', { name: 'Hours trained' });
  await expect(hours.getByText('1.5 h at this rank')).toBeVisible();
  await expect(hours.getByText(/2 h in this style in all · A record only\. Grading doesn't use hours\./)).toBeVisible();
  await expect(bjj(page).getByText('The % is classes out of classes required.')).toBeVisible();
});

test('Log a class: picking a class logs one class and its length', async ({ page }) => {
  const cls = await db.class.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      title: 'Adult Fundamentals',
      activities: ['BJJ'],
      styles: [{ disciplineId: s.disciplineId, classType: null }],
      startDate: hoursAgo(26),
      endDate: hoursAgo(24.5),
    },
  });
  await page.goto(`/students/${s.student.id}`);
  await bjj(page).getByRole('button', { name: 'Log a class' }).click();
  const dialog = page.getByRole('dialog', { name: 'Log a class — BJJ' });
  await expect(dialog.getByRole('radio', { name: 'Class', exact: true })).toBeChecked();
  await expect(dialog.getByRole('combobox', { name: 'Class' })).toHaveValue(cls.id);
  await expect(dialog.getByRole('option', { name: /^Adult Fundamentals · .+ · 90 min$/ })).toBeAttached();
  await expect(dialog.getByText(/^Adds 1 class and 1\.5 hours\./)).toBeVisible();
  await dialog.getByRole('button', { name: 'Log class' }).click();
  await expect(dialog).toBeHidden();

  await expect(bjj(page).getByRole('listitem', { name: 'Classes: 4 of 3' })).toBeVisible();
  await expect(bjj(page).getByText('1.5 h at this rank')).toBeVisible();
  const [log] = await logs();
  expect(log).toMatchObject({ minutes: 90, classId: cls.id, source: 'LOGGED' });
});

test('Log a class: "No class" logs the minutes typed, 60 by default', async ({ page }) => {
  await page.goto(`/students/${s.student.id}`);
  await bjj(page).getByRole('button', { name: 'Log a class' }).click();
  const dialog = page.getByRole('dialog', { name: 'Log a class — BJJ' });
  // No BJJ class in the last week: only "No class" is offered.
  await expect(dialog.getByText('No class of this style in the last 7 days, so enter the time.')).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'No class (enter the time)' })).toBeChecked();
  const minutes = dialog.getByLabel('Time on the mat (minutes)');
  await expect(minutes).toHaveValue('60');
  await expect(dialog.getByText(/^Adds 1 class and 1 hours\./)).toBeVisible();
  await minutes.fill('0');
  await dialog.getByRole('button', { name: 'Log class' }).click();
  await expect(dialog.getByText('Enter the time in whole minutes, from 1 to 600.')).toBeVisible();
  await minutes.fill('30');
  await expect(dialog.getByText(/^Adds 1 class and 0\.5 hours\./)).toBeVisible();
  await dialog.getByRole('button', { name: 'Log class' }).click();
  await expect(dialog).toBeHidden();
  const [log] = await logs();
  expect(log).toMatchObject({ minutes: 30, classId: null });
});

test('a waiting fee: tag first, no Grade or Ready; cancelling it leaves the promotion to a coach', async ({ page }) => {
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
  await page.goto(`/students/${s.student.id}`);
  const card = bjj(page);
  await expect(card.getByText('Waiting for fee').first()).toBeVisible();
  await expect(card.getByRole('button', { name: 'Grade', exact: true })).toHaveCount(0);
  const box = card.getByRole('region', { name: 'Promotion fee' });
  await expect(box.getByText(/40\.00.* · White 2/)).toBeVisible();
  await expect(box.getByText('Sam was asked to accept the fee. The promotion to White 2 applies once it is accepted and paid.')).toBeVisible();

  await box.getByRole('button', { name: 'Cancel fee' }).click();
  const decide = page.getByRole('dialog', { name: 'Promote Sam Lee?' });
  await expect(decide.getByText('The fee for White 2 was cancelled.')).toBeVisible();
  await decide.getByRole('button', { name: 'Not now' }).click();
  await expect(box.getByText('Promotion to decide')).toBeVisible();
  await expect(box.getByText('No fee · White 2')).toBeVisible();

  await box.getByRole('button', { name: 'Promote to White 2' }).click();
  const grade = page.getByRole('dialog', { name: 'Grade — BJJ' });
  await expect(grade.getByRole('combobox').first()).toContainText('White 2');
  await grade.getByRole('button', { name: 'Cancel' }).click();
  await box.getByRole('button', { name: "Don't promote" }).click();
  await expect(card.getByRole('region', { name: 'Promotion fee' })).toHaveCount(0);
  expect((await db.promotionFeeRequest.findFirstOrThrow({ where: { studentId: s.student.id } })).status).toBe('CANCELLED');
});
