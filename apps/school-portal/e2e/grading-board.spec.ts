import { expect, test, type Page } from '@playwright/test';
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

test('bulk promote: calling order, "Needs a look" acknowledgement, and the printable report', async ({ page }) => {
  await page.goto('/grading');
  await page.getByLabel(`Select ${s.student.name}`).check();
  await page.getByLabel(`Select ${ben.name}`).check();
  await expect(page.getByText('2 selected')).toBeVisible();
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
