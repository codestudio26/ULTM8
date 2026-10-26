import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'crypto';
import { addStudent, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Grading Board (roadmap Phase 4, item 3), against the real API: columns,
 * search, "currently attending only", moving a student (button and drag,
 * both confirmed), bulk promote with the calling order, the "Needs a look"
 * acknowledgement and the printable report; plus "Log a class" and the
 * Active switch on the student panel.
 */
let s: GradingSchool;
let ben: { id: string; name: string };
let cat: { id: string; name: string };

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  // Sam Lee: White 1, 3 of 3 classes (100%), Armbar not signed off.
  ben = await addStudent(s, 'Ben', 'Ortiz', { rung: 'White 0', classes: 0, activeOverride: true }); // 0%
  cat = await addStudent(s, 'Cat', 'Ng', { rung: 'White 0', classes: 1, activeOverride: true }); // 33%
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

const column = (page: Page, name: string) => page.getByRole('region', { name });
const card = (page: Page, name: string) => page.getByRole('listitem', { name });

test('students are in columns by progress, and search narrows them', async ({ page }) => {
  await page.goto('/grading');
  await expect(column(page, 'Ready to Grade').getByRole('link', { name: s.student.name })).toBeVisible();
  await expect(column(page, 'Getting There').getByRole('link', { name: cat.name })).toBeVisible();
  await expect(column(page, 'Just Starting').getByRole('link', { name: ben.name })).toBeVisible();
  await expect(card(page, s.student.name).getByText('100%')).toBeVisible();
  await expect(card(page, s.student.name).getByText('Skills not signed off')).toBeVisible();

  await page.getByLabel('Search students').fill('cat');
  await expect(page.getByRole('link', { name: cat.name })).toBeVisible();
  await expect(page.getByRole('link', { name: ben.name })).toHaveCount(0);
});

test('"currently attending only" hides inactive students and says how many', async ({ page }) => {
  await page.goto('/grading');
  await expect(page.getByRole('link', { name: s.student.name })).toBeVisible();
  await page.getByLabel('Currently attending only').check();
  await expect(page.getByRole('link', { name: s.student.name })).toHaveCount(0); // no membership, no switch
  await expect(page.getByText('1 inactive hidden')).toBeVisible();
  await expect(page.getByRole('link', { name: ben.name })).toBeVisible();
});

test('Move puts a student in another column after confirming, and it is recorded', async ({ page }) => {
  await page.goto('/grading');
  await card(page, ben.name).getByRole('button', { name: `Move ${ben.name} to another column` }).click();
  const dialog = page.getByRole('dialog', { name: `Move ${ben.name}` });
  await dialog.getByLabel('Move to').selectOption({ label: 'Ready to Grade' });
  await expect(dialog.getByText(/changes their class count/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Move' }).click();
  await expect(dialog).toBeHidden();
  await expect(column(page, 'Ready to Grade').getByRole('link', { name: ben.name })).toBeVisible();
  const events = await db.promotionEvent.findMany({ where: { studentId: ben.id, type: 'ADJUSTMENT' } });
  expect(events).toHaveLength(1);
});

test('dragging a card to another column asks to confirm first', async ({ page }) => {
  await page.goto('/grading');
  await card(page, cat.name).dragTo(column(page, 'Just Starting'));
  const dialog = page.getByRole('dialog', { name: `Move ${cat.name}` });
  await expect(dialog.getByLabel('Move to')).toHaveValue('JUST_STARTING');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(column(page, 'Getting There').getByRole('link', { name: cat.name })).toBeVisible();
});

test('students with no home branch are in the owner\'s "No branch" group until given one (Decision 148.2)', async ({ page }) => {
  const north = await db.branch.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'North' } });
  await db.branch.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'South' } });
  for (const id of [s.student.id, ben.id]) {
    await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.schoolId, studentId: id, branchId: north.id } });
  }
  await page.goto('/grading');
  const group = page.getByRole('region', { name: 'No branch' });
  await expect(group.getByRole('link', { name: cat.name })).toBeVisible();
  await expect(group.getByRole('link', { name: ben.name })).toHaveCount(0);
  await expect(column(page, 'Getting There').getByRole('link', { name: cat.name })).toHaveCount(0);

  await group.getByLabel(`Home branch for ${cat.name}`).selectOption({ label: 'South' });
  await group.getByRole('button', { name: `Assign ${cat.name} to this branch` }).click();
  await expect(group).toBeHidden();
  await expect(column(page, 'Getting There').getByRole('link', { name: cat.name })).toBeVisible();
  const home = await db.studentHomeBranch.findFirst({ where: { schoolId: s.schoolId, studentId: cat.id }, include: { branch: true } });
  expect(home?.branch.name).toBe('South');
});

test('bulk promote: calling order, "Needs a look" acknowledgement, and the printable report', async ({ page }) => {
  // Only active students are graded up (Decision 283): Sam has no membership, so switch him on.
  await db.studentRank.updateMany({ where: { studentId: s.student.id }, data: { boardActiveOverride: true } });
  await page.goto('/grading');
  await page.getByLabel(`Select ${s.student.name}`).check();
  await page.getByLabel(`Select ${ben.name}`).check();
  await expect(page.getByRole('region', { name: 'Selection' }).getByText('2 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Promote selected' }).click();

  const dialog = page.getByRole('dialog', { name: 'Promote these students' });
  const order = dialog.getByRole('list', { name: 'Calling order' });
  await expect(order.getByRole('listitem').first()).toHaveAttribute('aria-label', `1. ${s.student.name}`);
  await expect(dialog.getByText('Needs a look: 1 skill not signed off')).toBeVisible();
  const promote = dialog.getByRole('button', { name: 'Promote 2 students' });
  await expect(promote).toBeDisabled();

  // Ben is called first.
  await dialog.getByRole('button', { name: `Move ${ben.name} up` }).click();
  await expect(order.getByRole('listitem').first()).toHaveAttribute('aria-label', `1. ${ben.name}`);
  await dialog.getByLabel('Note').fill('Spring Grading Day');
  await dialog.getByLabel(/I acknowledge the student marked/).check();
  await promote.click();

  const done = page.getByRole('dialog', { name: 'Students promoted' });
  await expect(done.getByText('You promoted 2 students.')).toBeVisible();
  await expect(done.getByRole('listitem').nth(0)).toHaveText(`${ben.name}: White 0 → White 1`);
  await expect(done.getByRole('listitem').nth(1)).toHaveText(`${s.student.name}: White 1 → White 2`);

  const [report] = await Promise.all([page.waitForEvent('popup'), done.getByRole('button', { name: 'Open printable report' }).click()]);
  await report.waitForLoadState();
  await expect(report.getByRole('heading', { name: 'Promotion report' })).toBeVisible();
  await expect(report.getByText('Spring Grading Day')).toBeVisible();
  await expect(report.locator('tbody tr').nth(0)).toContainText(ben.name);
  await expect(report.locator('tbody tr').nth(1)).toContainText(s.student.name);

  // White 1 → White 2 is the next stripe of the same belt: recorded as a bulk stripe award.
  const events = await db.promotionEvent.findMany({ where: { studentId: s.student.id, type: 'BULK_STRIPE_AWARD' } });
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ acknowledgedWithoutSkillSignoff: true, note: 'Spring Grading Day' });
});

test('bulk promote: one click removes a student from the batch (Decision 130)', async ({ page }) => {
  // Only active students are graded up (Decision 283): Sam has no membership, so switch him on.
  await db.studentRank.updateMany({ where: { studentId: s.student.id }, data: { boardActiveOverride: true } });
  await page.goto('/grading');
  await page.getByLabel(`Select ${s.student.name}`).check();
  await page.getByLabel(`Select ${ben.name}`).check();
  await page.getByRole('button', { name: 'Promote selected' }).click();
  const dialog = page.getByRole('dialog', { name: 'Promote these students' });
  const order = dialog.getByRole('list', { name: 'Calling order' });
  await expect(order.getByRole('listitem')).toHaveCount(2);

  await dialog.getByRole('button', { name: `Remove ${s.student.name} from this batch` }).click();
  await expect(order.getByRole('listitem')).toHaveCount(1);
  await expect(order.getByRole('listitem').first()).toHaveAttribute('aria-label', `1. ${ben.name}`);
  // Sam was the one needing a look; with him gone, Ben can be promoted straight away.
  await dialog.getByRole('button', { name: 'Promote 1 student' }).click();
  await expect(page.getByRole('dialog', { name: 'Students promoted' })).toBeVisible();
  const promoted = await db.promotionEvent.findMany({ where: { schoolId: s.schoolId, voidedAt: null, type: { in: ['BULK_PROMOTION', 'BULK_STRIPE_AWARD'] } } });
  expect(promoted.map((e) => e.studentId)).toEqual([ben.id]);
});

test('bulk promote has no limit: over 200 students go through, 200 at a time (Decision 282)', async ({ page }) => {
  test.setTimeout(120_000);
  for (let i = 0; i < 205; i++) await addStudent(s, 'Bulk', `Student ${String(i).padStart(3, '0')}`, { rung: 'White 0', activeOverride: true });
  await page.goto('/grading');
  const starting = column(page, 'Just Starting');
  await expect(starting.getByRole('button', { name: 'Show all 206' })).toBeVisible(); // 25 cards until asked
  await starting.getByRole('checkbox', { name: 'Select all in Just Starting' }).check();
  await expect(page.getByRole('region', { name: 'Selection' }).getByText('206 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Promote selected' }).click();
  const dialog = page.getByRole('dialog', { name: 'Promote these students' });
  await dialog.getByRole('button', { name: 'Promote 206 students' }).click();
  await expect(page.getByRole('dialog', { name: 'Students promoted' }).getByText('You promoted 206 students.')).toBeVisible({ timeout: 60_000 });
  expect(await db.promotionEvent.count({ where: { schoolId: s.schoolId, type: 'BULK_STRIPE_AWARD' } })).toBe(206);
});

/** 205 more students in Just Starting (206 with Ben), ticked and sent to the promote window. */
async function bigBatch(page: Page) {
  for (let i = 0; i < 205; i++) await addStudent(s, 'Bulk', `Student ${String(i).padStart(3, '0')}`, { rung: 'White 0', activeOverride: true });
  await page.goto('/grading');
  await column(page, 'Just Starting').getByRole('checkbox', { name: 'Select all in Just Starting' }).check();
  await page.getByRole('button', { name: 'Promote selected' }).click();
  return page.getByRole('dialog', { name: 'Promote these students' });
}
/** The real (not dry-run) bulk-promote requests, numbered from 1. */
function onSend(page: Page, handle: (n: number, route: import('@playwright/test').Route) => Promise<void>) {
  let n = 0;
  return page.route('**/grading/bulk-promote', async (route) => {
    if (route.request().postDataJSON()?.dryRun) return route.fallback();
    n += 1;
    await handle(n, route);
  });
}

test('a lost reply is sent again by itself, and nobody is promoted twice (Decision 284)', async ({ page }) => {
  test.setTimeout(150_000);
  const dialog = await bigBatch(page);
  // The second batch reaches the server, but its answer is lost.
  await onSend(page, async (n, route) => {
    if (n === 2) {
      await route.fetch();
      return route.fulfill({ status: 503, body: 'lost' });
    }
    return route.fallback();
  });
  await dialog.getByRole('button', { name: 'Promote 206 students' }).click();
  await expect(page.getByRole('dialog', { name: 'Students promoted' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/already promoted since the check/)).toBeVisible();
  expect(await db.promotionEvent.count({ where: { schoolId: s.schoolId } })).toBe(206);
});

test('a batch that keeps failing offers "Try the remaining students again" (Decision 284)', async ({ page }) => {
  test.setTimeout(150_000);
  const dialog = await bigBatch(page);
  let down = true;
  await onSend(page, async (n, route) => (n >= 2 && down ? route.fulfill({ status: 503, body: 'down' }) : route.fallback()));
  await dialog.getByRole('button', { name: 'Promote 206 students' }).click();
  const stopped = page.getByRole('dialog', { name: 'Promote these students' });
  await expect(stopped.getByText('Promoted 200 of 206, then something went wrong. The rest were not promoted yet.')).toBeVisible({ timeout: 60_000 });
  expect(await db.promotionEvent.count({ where: { schoolId: s.schoolId } })).toBe(200);
  down = false;
  await stopped.getByRole('button', { name: 'Try the remaining 6 students again' }).click();
  await expect(page.getByRole('dialog', { name: 'Students promoted' }).getByText('You promoted 206 students.')).toBeVisible({ timeout: 60_000 });
  expect(await db.promotionEvent.count({ where: { schoolId: s.schoolId } })).toBe(206);
});

test('"Stop here" lists the students the batch never reached (Decision 284)', async ({ page }) => {
  // No answer at all, even after the automatic retry: nothing is promoted yet.
  await onSend(page, async (_n, route) => route.fulfill({ status: 503, body: 'down' }));
  await page.goto('/grading');
  await page.getByLabel(`Select ${ben.name}`).check();
  await page.getByLabel(`Select ${cat.name}`).check();
  await page.getByRole('button', { name: 'Promote selected' }).click();
  await page.getByRole('dialog', { name: 'Promote these students' }).getByRole('button', { name: 'Promote 2 students' }).click();
  await expect(page.getByText('Promoted 0 of 2, then something went wrong. The rest were not promoted yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try the remaining 2 students again' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop here and see the report' }).click();
  const done = page.getByRole('dialog', { name: 'Students promoted' });
  await expect(done.getByText('You promoted 0 students.')).toBeVisible();
  await expect(done.getByText(/not promoted: the batch stopped before them/)).toBeVisible();
  expect(await db.promotionEvent.count({ where: { schoolId: s.schoolId } })).toBe(0);
});

test('an inactive student can\'t be ticked (Decision 283)', async ({ page }) => {
  await page.goto('/grading');
  await expect(card(page, s.student.name).getByText('Inactive')).toBeVisible();
  await expect(page.getByLabel(`${s.student.name} can't be selected: inactive`)).toBeDisabled();
  await expect(page.getByLabel(`Select ${ben.name}`)).toBeEnabled();
});

test('ticked students a search hides are counted, and "Show them" brings them back', async ({ page }) => {
  await page.goto('/grading');
  await page.getByLabel(`Select ${ben.name}`).check();
  await page.getByLabel(`Select ${cat.name}`).check();
  await page.getByLabel('Search students').fill('cat');
  await expect(page.getByRole('region', { name: 'Selection' }).getByText('2 selected')).toBeVisible();
  const selection = page.getByRole('region', { name: 'Selection' });
  await expect(selection.getByText('1 of them hidden by your search')).toBeVisible();
  await selection.getByRole('button', { name: 'Show them' }).click();
  await expect(page.getByLabel('Search students')).toHaveValue('');
  await expect(page.getByRole('link', { name: ben.name })).toBeVisible();
});

test('a style that requires skills: a student missing them can\'t be ticked', async ({ page }) => {
  await db.discipline.update({ where: { id: s.disciplineId }, data: { skillsRequiredToGrade: true } });
  await page.goto('/grading');
  await expect(card(page, s.student.name).getByText('Skills required')).toBeVisible();
  await expect(page.getByLabel(`${s.student.name} can't be selected: required skills not signed off`)).toBeDisabled();
});

test('works with the keyboard only: move a student', async ({ page }) => {
  await page.goto('/grading');
  const moveBen = card(page, ben.name).getByRole('button', { name: `Move ${ben.name} to another column` });
  await expect(moveBen).toBeVisible();
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    if (await moveBen.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(moveBen).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: `Move ${ben.name}` });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    if (await dialog.getByLabel('Move to').evaluate((el) => el === document.activeElement)) break;
  }
  await page.keyboard.press('ArrowDown'); // Getting There → Ready to Grade
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Move' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(column(page, 'Ready to Grade').getByRole('link', { name: ben.name })).toBeVisible();
});

test('student panel: "Log a class" adds one, and the Active switch sets attending by hand', async ({ page }) => {
  await page.goto(`/students/${ben.id}`);
  const bjj = page.getByRole('region', { name: 'BJJ' });
  await expect(bjj.getByText('Classes: 0 of 3')).toBeVisible();
  await bjj.getByRole('button', { name: 'Log a class (+1)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Log a class — BJJ' });
  await dialog.getByRole('button', { name: 'Log class' }).click();
  await expect(dialog).toBeHidden();
  await expect(bjj.getByText('Classes: 1 of 3')).toBeVisible();
  await expect(bjj.getByText(/Class logged by hand/)).toBeVisible();

  await bjj.getByLabel('Currently attending BJJ').selectOption('INACTIVE');
  await expect.poll(async () => (await db.studentRank.findFirstOrThrow({ where: { studentId: ben.id } })).boardActiveOverride).toBe(false);
});
