import { expect, test } from '@playwright/test';
import { randomUUID } from 'crypto';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The coach's web portal (Decision 184), against the real API: a coach lands
 * on their dashboard, sees only the styles they grade in, and only the
 * actions their grading permission allows.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // BJJ; Sam Lee at White 1 with 3 of 3 classes: ready to grade
});

test.afterAll(async () => {
  await cleanup();
});

async function coachWith(toggles: Partial<Record<'canPromote' | 'canAdjustProgress' | 'canChangeBoardThresholds', boolean>> | null, alsoStudent = false) {
  const coach = await addPerson('Cody', 'Coach', [
    { role: 'INSTRUCTOR', schoolId: s.schoolId },
    ...(alsoStudent ? [{ role: 'STUDENT' as const, schoolId: s.schoolId }] : []),
  ]);
  if (toggles) {
    await db.gradingPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: coach.id, disciplineId: s.disciplineId, ...toggles } });
  }
  return coach;
}

test('a coach lands on their dashboard: grading, classes and notifications', async ({ page }) => {
  const coach = await coachWith({});
  await db.timetableSlot.create({
    data: {
      id: randomUUID(), schoolId: s.schoolId, instructorId: coach.id, weekday: 'TUESDAY', title: 'Kids BJJ',
      startTime: new Date('1970-01-01T17:00:00Z'), endTime: new Date('1970-01-01T18:00:00Z'),
    },
  });
  await db.notification.create({ data: { id: randomUUID(), userId: coach.id, title: 'Sam Lee is ready to grade', body: 'BJJ: White 1 → White 2' } });
  await signIn(page, coach.token);
  await page.goto('/');

  await expect(page).toHaveURL(/\/coach$/);
  await expect(page.getByRole('heading', { name: 'Coach dashboard' })).toBeVisible();
  await expect(page.getByText('Coach', { exact: true })).toBeVisible(); // role in the header
  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Grading Board' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Transactions' })).toHaveCount(0);

  const grading = page.getByRole('region', { name: 'Grading' });
  await expect(grading.getByText('BJJ')).toBeVisible();
  await expect(grading.getByText('1 ready to grade')).toBeVisible();
  await expect(page.getByRole('region', { name: 'My classes' }).getByText(/Tuesday .*Kids BJJ/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Notifications' }).getByText('Sam Lee is ready to grade')).toBeVisible();
  await expect(page.getByRole('region', { name: 'My training' })).toHaveCount(0);
});

test('the board and the student panel show only what the coach may do', async ({ page }) => {
  const coach = await coachWith({ canPromote: true, canAdjustProgress: false, canChangeBoardThresholds: false });
  await signIn(page, coach.token);
  await page.goto('/grading');
  const card = page.getByRole('listitem', { name: s.student.name });
  await expect(card).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change %' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: /^Move / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Promote selected' })).toBeVisible();

  await card.getByRole('link', { name: s.student.name }).click();
  await expect(page.getByRole('heading', { name: s.student.name })).toBeVisible();
  const bjj = page.getByRole('region', { name: 'BJJ' });
  await expect(bjj.getByRole('button', { name: 'Grade' })).toBeVisible();
  await expect(bjj.getByRole('button', { name: 'Correct date' })).toHaveCount(0);
  await expect(bjj.getByRole('button', { name: 'Log a class (+1)' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '← Grading Board' })).toBeVisible();
});

test('a coach with no styles is told so', async ({ page }) => {
  const coach = await coachWith(null);
  await signIn(page, coach.token);
  await page.goto('/grading');
  await expect(page.getByText("The School owner hasn't given you grading in any style yet.")).toBeVisible();
});

test('a coach who also trains here sees their own rank', async ({ page }) => {
  const coach = await coachWith({}, true);
  await db.studentRank.create({
    data: {
      id: randomUUID(), studentId: coach.id, disciplineId: s.disciplineId, schoolId: s.schoolId,
      currentRankId: s.rung['Blue 0'].rankId, currentStripeId: s.rung['Blue 0'].id,
    },
  });
  await signIn(page, coach.token);
  await page.goto('/coach');
  const mine = page.getByRole('region', { name: 'My training' });
  await expect(mine.getByText('Blue 0')).toBeVisible();
});
