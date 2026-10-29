import { randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Belt correction requests (backlog 3.13; Decisions 286, 299): a student
 * asked in the app for their belt to be corrected. On the student's page the
 * owner sees the request with the student's note, and approves it (the
 * student moves, and the history shows the correction) or rejects it.
 *
 * Seed: Sam Lee holds White 1 in BJJ.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

const ask = (to: string) =>
  db.rankCorrectionRequest.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      studentId: s.student.id,
      disciplineId: s.disciplineId,
      fromRankId: s.rung['White 1'].rankId,
      fromStripeTierId: s.rung['White 1'].id,
      requestedRankId: s.rung[to].rankId,
      requestedStripeTierId: s.rung[to].id,
      note: 'I was promoted at my old club.',
    },
  });

test('the owner approves a request: the student moves, and the history shows it', async ({ page }) => {
  const request = await ask('Blue 0');
  await page.goto(`/students/${s.student.id}`);
  const box = page.getByRole('region', { name: 'Belt correction asked' });
  await expect(box.getByText(/Sam asked to correct their belt from White 1 to Blue 0/)).toBeVisible();
  await expect(box.getByText('Their note: “I was promoted at my old club.”')).toBeVisible();
  await box.getByLabel('Note to the student (optional)').fill('Checked with your old coach.');
  await box.getByRole('button', { name: 'Approve: Blue 0' }).click();
  await expect(box).toBeHidden();
  const sr = await db.studentRank.findUniqueOrThrow({ where: { studentId_disciplineId: { studentId: s.student.id, disciplineId: s.disciplineId } } });
  expect(sr.currentStripeId).toBe(s.rung['Blue 0'].id);
  expect(await db.rankCorrectionRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ status: 'APPROVED', reviewNote: 'Checked with your old coach.' });
  await expect(page.getByRole('region', { name: 'BJJ' }).getByText('Blue 0', { exact: true }).first()).toBeVisible();
});

test('the owner rejects a request: nothing changes', async ({ page }) => {
  const request = await ask('White 2');
  await page.goto(`/students/${s.student.id}`);
  const box = page.getByRole('region', { name: 'Belt correction asked' });
  await box.getByRole('button', { name: 'Reject' }).click();
  await expect(box).toBeHidden();
  expect((await db.rankCorrectionRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('REJECTED');
  const sr = await db.studentRank.findUniqueOrThrow({ where: { studentId_disciplineId: { studentId: s.student.id, disciplineId: s.disciplineId } } });
  expect(sr.currentStripeId).toBe(s.rung['White 1'].id);
});
