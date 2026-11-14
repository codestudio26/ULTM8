import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, addStudent, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The Grading Board page in the new look (Decision 460): the new page header
 * with the Grading tabs, white cards, and our own drop-downs for the style
 * and a student's home branch, with no browser <select> left. Picking still
 * does what the old <select> did, for the owner and for a coach, and the
 * page fits a phone.
 */
let s: GradingSchool;
let cat: { id: string; name: string };
let judo: { disciplineId: string; student: { id: string; name: string } };

/** A second style, Judo (one belt), with one student on it. */
async function addJudo(school: GradingSchool) {
  const discipline = await db.discipline.create({ data: { id: randomUUID(), schoolId: school.schoolId, name: 'Judo', classTypesOffered: [] } });
  const tiers: string[] = [];
  for (const [order, name, colour] of [
    [0, 'Judo White', '#FFFFFF'],
    [1, 'Judo Yellow', '#FACC15'],
  ] as const) {
    const rank = await db.rank.create({ data: { id: randomUUID(), disciplineId: discipline.id, schoolId: school.schoolId, order, name, primaryColour: colour } });
    const tier = await db.rankStripeTier.create({
      data: { id: randomUUID(), rankId: rank.id, schoolId: school.schoolId, order: 0, count: 0, colour: '#000000', name, stripeSegments: [], classesRequired: 3 },
    });
    tiers.push(tier.id);
  }
  const first = await db.rankStripeTier.findUniqueOrThrow({ where: { id: tiers[0] } });
  const student = await addPerson('Jun', 'Mori', [{ role: 'STUDENT', schoolId: school.schoolId }]);
  await db.studentRank.create({
    data: {
      id: randomUUID(), studentId: student.id, disciplineId: discipline.id, schoolId: school.schoolId,
      currentRankId: first.rankId, currentStripeId: first.id, classesAttendedTowardCheckpoint: 1, boardActiveOverride: true,
      dateOfCurrentRank: new Date(Date.now() - 60 * 86_400_000),
    },
  });
  return { disciplineId: discipline.id, student: { id: student.id, name: student.name } };
}

test.beforeEach(async () => {
  s = await seedGradingSchool(); // BJJ; Sam Lee at White 1
  cat = await addStudent(s, 'Cat', 'Ng', { rung: 'White 0', classes: 1, activeOverride: true }); // 33%
  judo = await addJudo(s);
});

test.afterAll(async () => {
  await cleanup();
});

const header = (page: Page) => page.locator('.u8n-page-header');
/** The style switch (Decision 462 item 11): one button per style, the chosen one pressed. */
const styleField = (page: Page) => page.getByRole('group', { name: 'Style', exact: true });
const styleButton = (page: Page, name: string) => styleField(page).getByRole('button', { name, exact: true });

test('the board has the new header with the Grading tabs, new-look cards and no browser <select>', async ({ page }) => {
  // Two branches and Cat with none, so the owner's "No branch" group and its picker show too.
  const north = await db.branch.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'North' } });
  await db.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.schoolId, studentId: s.student.id, branchId: north.id } });
  await signIn(page, s.ownerToken);
  await page.goto('/grading');

  await expect(header(page).getByRole('heading', { level: 1, name: 'Grading Board' })).toBeVisible();
  await expect(header(page).getByText("Every student's progress toward their next rank.", { exact: false })).toBeVisible();
  const tabs = header(page).getByRole('navigation', { name: 'Grading', exact: true });
  await expect(tabs.getByRole('link', { name: 'Board' })).toHaveAttribute('aria-current', 'page');
  await expect(tabs.getByRole('link', { name: 'Styles & Belts' })).toHaveAttribute('href', '/disciplines');
  await expect(page.locator('.ultm8-page-header')).toHaveCount(0);
  await expect(page.locator('.ultm8-tabs')).toHaveCount(0);
  await expect(page.locator('.u8gb .ultm8-card')).toHaveCount(0);
  await expect(page.locator('.u8gb .u8b-card').first()).toBeVisible();

  const group = page.getByRole('region', { name: 'No branch' });
  await expect(group.getByRole('combobox', { name: `Home branch for ${cat.name}` })).toBeVisible();
  await expect(styleField(page)).toBeVisible();
  await expect(page.locator('.u8gb select')).toHaveCount(0);

  // Opening the student panel still works, and its card is the new look's.
  await page.getByRole('listitem', { name: s.student.name }).locator('.u8gb-card__pct').click();
  const panel = page.getByRole('region', { name: `${s.student.name}: grading` });
  await expect(panel).toBeVisible();
  await expect(page.locator('.u8gb-panel')).toBeVisible();
});

test('picking a style on the style switch shows that style\'s students, as the drop-down did', async ({ page }) => {
  await signIn(page, s.ownerToken);
  await page.goto('/grading');
  await expect(page.getByRole('combobox', { name: 'Style', exact: true })).toHaveCount(0);
  await expect(styleField(page).getByRole('button')).toHaveText(['BJJ', 'Judo']);
  await expect(styleButton(page, 'BJJ')).toHaveAttribute('aria-pressed', 'true');
  await expect(styleButton(page, 'Judo')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('listitem', { name: cat.name })).toBeVisible();
  // Tick Cat: changing the style clears the selection, as before.
  await page.getByLabel(`Select ${cat.name}`).check();
  await expect(page.getByRole('region', { name: 'Selection' }).getByText('1 selected')).toBeVisible();

  await styleButton(page, 'Judo').click();
  await expect(styleButton(page, 'Judo')).toHaveAttribute('aria-pressed', 'true');
  await expect(styleButton(page, 'BJJ')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('listitem', { name: judo.student.name })).toBeVisible();
  await expect(page.getByRole('listitem', { name: cat.name })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Selection' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Promote selected' })).toBeDisabled();

  // And back.
  await styleButton(page, 'BJJ').click();
  await expect(page.getByRole('listitem', { name: cat.name })).toBeVisible();
  await expect(page.getByRole('listitem', { name: judo.student.name })).toHaveCount(0);
});

test('picking a home branch on a "No branch" card doesn\'t open the student\'s panel', async ({ page }) => {
  await db.branch.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'South' } });
  await signIn(page, s.ownerToken);
  await page.goto('/grading');
  const group = page.getByRole('region', { name: 'No branch' });
  const field = group.getByRole('combobox', { name: `Home branch for ${cat.name}` });
  await expect(group.getByRole('button', { name: `Assign ${cat.name} to this branch` })).toBeDisabled();
  await field.click();
  await group.getByRole('option', { name: 'South' }).click();
  await expect(field.locator('[data-shown="true"]')).toHaveText('South');
  await expect(page.getByRole('region', { name: `${cat.name}: grading` })).toHaveCount(0);
  await expect(group.getByRole('button', { name: `Assign ${cat.name} to this branch` })).toBeEnabled();
});

test('a coach sees the same header and only the styles they grade', async ({ page }) => {
  const staff = await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId }]);
  await db.gradingPermission.create({ data: { id: randomUUID(), schoolId: s.schoolId, userId: staff.id, disciplineId: s.disciplineId } });
  await signIn(page, staff.token);
  await page.goto('/grading');
  await expect(header(page).getByRole('heading', { level: 1, name: 'Grading Board' })).toBeVisible();
  await expect(header(page).getByRole('navigation', { name: 'Grading', exact: true }).getByRole('link', { name: 'Board' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('listitem', { name: cat.name })).toBeVisible();
  await expect(styleField(page).getByRole('button')).toHaveText(['BJJ']);
  await expect(page.locator('.u8gb select')).toHaveCount(0);
  // No "No branch" group: that is the owner's (Decision 148.2).
  await expect(page.getByRole('region', { name: 'No branch' })).toHaveCount(0);
});

test('on a phone the board fits the screen and the columns stack', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, s.ownerToken);
  await page.goto('/grading');
  await expect(page.getByRole('listitem', { name: cat.name })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const boxes = await Promise.all(['Just Starting', 'Getting There', 'Ready to Grade'].map((name) => page.getByRole('region', { name }).boundingBox()));
  expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
  expect(boxes[2]!.y).toBeGreaterThan(boxes[1]!.y + boxes[1]!.height - 1);
  await expect(styleField(page)).toBeVisible();
  const field = await styleField(page).boundingBox();
  expect(field!.x + field!.width).toBeLessThanOrEqual(390);
});
