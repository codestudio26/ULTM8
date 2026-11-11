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

// Classes made here (Coaches review CP3) aren't cleaned by the shared cleanup.
test.afterEach(async () => {
  await db.class.deleteMany({ where: { schoolId: s.schoolId } });
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
  // Sam's one required skill signed off: every requirement met, 100% (Decision 321 item 7).
  const samRank = await db.studentRank.findFirstOrThrow({ where: { studentId: s.student.id, disciplineId: s.disciplineId } });
  await db.studentRankSkillStatus.create({ data: { id: randomUUID(), studentRankId: samRank.id, schoolId: s.schoolId, studentId: s.student.id, skillId: s.skillId, status: 'SIGNED_OFF' } });
  await db.timetableSlot.create({
    data: {
      id: randomUUID(), schoolId: s.schoolId, instructorId: coach.id, weekday: 'TUESDAY', title: 'Kids BJJ',
      startTime: new Date('1970-01-01T17:00:00Z'), endTime: new Date('1970-01-01T18:00:00Z'),
    },
  });
  await db.notification.create({ data: { id: randomUUID(), userId: coach.id, title: 'Sam Lee is ready to grade', body: 'BJJ: White 1 → White 2' } });
  // The job's own "ready to grade" alert: the panel's Ready to grade list is the one place for it.
  await db.notification.create({ data: { id: randomUUID(), userId: coach.id, title: 'Ready to grade', body: 'Sam Lee is ready for White 2 (BJJ).', type: 'GRADING_READY', targetType: 'GRADING' } });
  const soon = new Date(Date.now() + 86_400_000);
  const nextClass = await db.class.create({ data: { id: randomUUID(), schoolId: s.schoolId, instructorId: coach.id, title: 'Open mat', startDate: soon, endDate: new Date(soon.getTime() + 3_600_000) } });
  await signIn(page, coach.token);
  await page.goto('/');

  await expect(page).toHaveURL(/\/coach$/);
  await expect(page.getByRole('heading', { name: 'Coach dashboard' })).toBeVisible();
  await expect(page.getByText('Coach', { exact: true })).toBeVisible(); // role in the header
  const nav = page.getByRole('navigation', { name: 'Main menu' });
  await expect(nav.getByRole('link', { name: 'Grading', exact: true })).toBeVisible();
  // Transactions lives under Billing, which a coach doesn't have.
  await expect(nav.getByRole('link', { name: 'Billing' })).toHaveCount(0);

  const grading = page.getByRole('region', { name: 'Grading' });
  await expect(grading.getByText('BJJ')).toBeVisible();
  await expect(grading.getByText('1 ready to grade')).toBeVisible();
  await expect(page.getByRole('region', { name: 'My classes' }).getByText(/Tuesday .*Kids BJJ/)).toBeVisible();
  const notes = page.getByRole('region', { name: 'Notifications' });
  await expect(notes.getByText('Sam Lee is ready to grade')).toBeVisible();
  await expect(notes.getByText('"Ready to grade" alerts are in the Ready to grade list.')).toBeVisible();
  await expect(notes.getByText('Sam Lee is ready for White 2 (BJJ).')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'My training' })).toHaveCount(0);

  // The right panel (DESIGN.md → "Coach view: nothing shown twice"): the next
  // class, with its roll call and QR code, then the Ready to grade list.
  const panel = page.getByRole('complementary', { name: 'Next class' });
  const next = panel.getByRole('region', { name: 'Next class' });
  await expect(next).toContainText('Open mat');
  await expect(next.getByRole('link', { name: 'Roll call' })).toHaveAttribute('href', `/classes/${nextClass.id}/roll-call`);
  await expect(next.getByRole('link', { name: 'Show QR' })).toHaveAttribute('href', `/classes/${nextClass.id}/qr-code`);
  // Shown once: not again under Coming up.
  await expect(page.getByRole('region', { name: 'My classes' }).getByText('Open mat')).toHaveCount(0);
  const ready = panel.getByRole('list', { name: 'Ready to grade' });
  const sam = ready.getByRole('link', { name: new RegExp(s.student.name) });
  await expect(sam).toContainText('White 1 → White 2');
  // A grading link: the student page's Ranks tab, at this style (Decision 457).
  await expect(sam).toHaveAttribute('href', `/students/${s.student.id}?tab=ranks#grading-${s.disciplineId}`);
  await sam.click();
  await expect(page).toHaveURL(new RegExp(`/students/${s.student.id}\\?tab=ranks`));
  await expect(page.getByRole('heading', { name: s.student.name })).toBeVisible();
});

test('Branch Staff with grading rights: the branch\'s classes, and the Ready to grade list in the panel', async ({ page }) => {
  const staff = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId }]);
  await db.gradingPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: staff.id, disciplineId: s.disciplineId } });
  // Sam's one required skill signed off: ready to grade.
  const samRank = await db.studentRank.findFirstOrThrow({ where: { studentId: s.student.id, disciplineId: s.disciplineId } });
  await db.studentRankSkillStatus.create({ data: { id: randomUUID(), studentRankId: samRank.id, schoolId: s.schoolId, studentId: s.student.id, skillId: s.skillId, status: 'SIGNED_OFF' } });
  const start = new Date(Date.now() + 2 * 86_400_000);
  await db.class.create({ data: { id: randomUUID(), schoolId: s.schoolId, title: 'Lunch BJJ', startDate: start, endDate: new Date(start.getTime() + 3_600_000) } });
  await signIn(page, staff.token);
  await page.goto('/coach');

  await expect(page.getByRole('heading', { name: 'Coach dashboard' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Classes at your branch this week' }).getByRole('listitem').filter({ hasText: 'Lunch BJJ' })).toBeVisible();
  // Branch Staff who don't teach have no My classes card and no Next class.
  await expect(page.getByRole('region', { name: 'My classes' })).toHaveCount(0);
  const panel = page.getByRole('complementary', { name: 'Ready to grade' });
  await expect(panel.getByRole('region', { name: 'Next class' })).toHaveCount(0);
  await expect(panel.getByRole('link', { name: new RegExp(s.student.name) })).toHaveAttribute('href', new RegExp(`/students/${s.student.id}\\?tab=ranks`));
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
  // A student's grading is the Ranks tab of their page (DESIGN.md → "Grading screens");
  // from the board it opens on that tab (Decision 457).
  await expect(page).toHaveURL(new RegExp(`/students/${s.student.id}\\?tab=ranks$`));
  const bjj = page.getByRole('region', { name: 'BJJ' });
  await expect(bjj.getByRole('button', { name: 'Grade' })).toBeVisible();
  await expect(bjj.getByRole('button', { name: 'Correct date' })).toHaveCount(0);
  await expect(bjj.getByRole('button', { name: 'Log a class' })).toHaveCount(0);
  await expect(page.locator('.u8n-page-header').getByRole('link', { name: 'Grading Board', exact: true })).toBeVisible();
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

test('archived weekly slots are left out and a cancelled class is marked, with no roll call (Coaches review CP2, CP3)', async ({ page }) => {
  const coach = await coachWith({});
  const slot = (title: string, archivedAt: Date | null) =>
    db.timetableSlot.create({
      data: {
        id: randomUUID(), schoolId: s.schoolId, instructorId: coach.id, weekday: 'WEDNESDAY', title, archivedAt,
        startTime: new Date('1970-01-01T17:00:00Z'), endTime: new Date('1970-01-01T18:00:00Z'),
      },
    });
  await slot('Live slot', null);
  await slot('Archived slot', new Date());
  // The soonest class is the panel's Next class; Coming up starts after it.
  const first = new Date(Date.now() + 86_400_000);
  await db.class.create({ data: { id: randomUUID(), schoolId: s.schoolId, instructorId: coach.id, title: 'First class', startDate: first, endDate: new Date(first.getTime() + 3_600_000) } });
  const start = new Date(Date.now() + 2 * 86_400_000);
  const end = new Date(start.getTime() + 3_600_000);
  await db.class.create({ data: { id: randomUUID(), schoolId: s.schoolId, instructorId: coach.id, title: 'Running class', startDate: start, endDate: end } });
  await db.class.create({ data: { id: randomUUID(), schoolId: s.schoolId, instructorId: coach.id, title: 'Called-off class', startDate: start, endDate: end, cancelledAt: new Date() } });
  await signIn(page, coach.token);
  await page.goto('/coach');

  const classes = page.getByRole('region', { name: 'My classes' });
  await expect(classes.getByText(/Wednesday .*Live slot/)).toBeVisible();
  await expect(classes.getByText('Archived slot')).toHaveCount(0);
  const running = classes.getByRole('listitem').filter({ hasText: 'Running class' });
  await expect(running.getByRole('link', { name: 'Roll call' })).toBeVisible();
  const cancelled = classes.getByRole('listitem').filter({ hasText: 'Called-off class' });
  await expect(cancelled.getByText('Cancelled')).toBeVisible();
  await expect(cancelled.getByRole('link')).toHaveCount(0);
});

test('owner-only pages typed in by a coach go back to the coach dashboard, never a blank page (Coaches review CP5)', async ({ page }) => {
  const coach = await coachWith({});
  await signIn(page, coach.token);
  for (const path of ['/dashboard', '/branches', '/grading/permissions', '/bookings-drilldown']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/coach$/);
    await expect(page.getByRole('heading', { name: 'Coach dashboard' })).toBeVisible();
  }
});

test('a coach sees the student list, read only, and "Coming up" shows the time and branch (Decision 425 Q2, Q4)', async ({ page }) => {
  const coach = await coachWith({});
  await signIn(page, coach.token);
  await page.goto('/coach');
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: 'Students', exact: true }).click();
  await expect(page).toHaveURL(/\/students$/);
  await expect(page.getByRole('button', { name: s.student.name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite a Student' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add manually' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Manage rosters' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Attendance' })).toBeVisible();

  const north = await db.branch.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'North' } });
  // The soonest class is the panel's Next class; Coming up starts after it.
  const first = new Date(Date.now() + 86_400_000);
  await db.class.create({ data: { id: randomUUID(), schoolId: s.schoolId, instructorId: coach.id, title: 'First class', startDate: first, endDate: new Date(first.getTime() + 3_600_000) } });
  const start = new Date(Date.now() + 2 * 86_400_000);
  await db.class.create({ data: { id: randomUUID(), schoolId: s.schoolId, branchId: north.id, instructorId: coach.id, title: 'Evening BJJ', startDate: start, endDate: new Date(start.getTime() + 3_600_000) } });
  await page.goto('/coach');
  const row = page.getByRole('region', { name: 'My classes' }).getByRole('listitem').filter({ hasText: 'Evening BJJ' });
  await expect(row).toContainText('North');
  await expect(row).toContainText(/\d{1,2}:\d{2}/);
});

test('"Coming up" names no branch while the coach can\'t see the class\'s branch; "Whole School" is only for a class with no branch (Decision 425 Q4)', async ({ page }) => {
  const north = await db.branch.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'North' } });
  const coach = await coachWith({});
  const start = new Date(Date.now() + 2 * 86_400_000);
  const mk = (title: string, branchId: string | null) =>
    db.class.create({ data: { id: randomUUID(), schoolId: s.schoolId, branchId, instructorId: coach.id, title, startDate: start, endDate: new Date(start.getTime() + 3_600_000) } });
  // The soonest class is the panel's Next class; Coming up starts after it.
  const first = new Date(Date.now() + 86_400_000);
  await db.class.create({ data: { id: randomUUID(), schoolId: s.schoolId, instructorId: coach.id, title: 'First class', startDate: first, endDate: new Date(first.getTime() + 3_600_000) } });
  await mk('Morning BJJ', north.id);
  await mk('Open mat', null);
  // Hold the branch list back: until it arrives the coach can't see North,
  // and a class there must not be called "Whole School" (it used to be).
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/v1/schools/*/branches?**', async (route) => {
    await held;
    await route.continue();
  });
  await signIn(page, coach.token);
  await page.goto('/coach');

  const classes = page.getByRole('region', { name: 'My classes' });
  const morning = classes.getByRole('listitem').filter({ hasText: 'Morning BJJ' });
  await expect(morning).toContainText(/\d{1,2}:\d{2}.* · Morning BJJ/);
  await expect(classes.getByRole('listitem').filter({ hasText: 'Open mat' })).toContainText('Open mat · Whole School');
  await expect(morning).not.toContainText('Whole School');
  await expect(morning).not.toContainText('North');

  release();
  await expect(morning).toContainText('Morning BJJ · North');
  await expect(morning).not.toContainText('Whole School');
});
