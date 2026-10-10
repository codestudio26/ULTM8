import { expect, test, type Page } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Ladder editor (roadmap Phase 4, item 1; Decisions 152, 180), against the
 * real API: belts in order with their rungs; reorder belts and rungs with a
 * confirmation naming the students affected; edit a rung's rules; a held rung
 * can't be removed; add a belt.
 *
 * Seed: BJJ, White 0 → White 1 → White 2 → Blue 0; Sam Lee holds White 1.
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

const ladder = (page: Page) => page.getByRole('list', { name: 'Ladder' });
const beltOrder = async () => (await db.rank.findMany({ where: { disciplineId: s.disciplineId }, orderBy: { order: 'asc' }, select: { name: true } })).map((r) => r.name);
const rungsOf = async (name: string) =>
  db.rankStripeTier.findMany({ where: { rank: { disciplineId: s.disciplineId, name } }, orderBy: { order: 'asc' } });

test('shows the belts in order, with their rungs', async ({ page }) => {
  await page.goto(`/disciplines/${s.disciplineId}`);
  await expect(ladder(page).getByRole('listitem', { name: '1. White' })).toBeVisible();
  await expect(ladder(page).getByRole('listitem', { name: '2. Blue' })).toBeVisible();
  await expect(ladder(page).getByText('White 1 · 3 classes')).toBeVisible();
  await expect(ladder(page).getByText('White 2 · 3 classes · 1 skill')).toBeVisible();
});

test('reordering belts names the students affected, then saves', async ({ page }) => {
  await page.goto(`/disciplines/${s.disciplineId}`);
  await page.getByRole('button', { name: 'Move Blue up' }).click();
  await expect(page.getByText("The new order isn't saved yet.")).toBeVisible();
  await page.getByRole('button', { name: 'Save order' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reorder belts?' });
  await expect(dialog.getByText('Sam Lee')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save order' }).click();
  await expect(dialog).toBeHidden();
  await expect(ladder(page).getByRole('listitem', { name: '1. Blue' })).toBeVisible();
  expect(await beltOrder()).toEqual(['Blue', 'White']);
});

test('editing a rung: name, "each type" numbers and time in rank only', async ({ page }) => {
  await db.discipline.update({ where: { id: s.disciplineId }, data: { classTypesOffered: ['Fundamentals', 'Sparring'] } });
  await page.goto(`/disciplines/${s.disciplineId}`);
  await page.getByRole('button', { name: 'Edit White' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit White' });

  await dialog.getByRole('button', { name: 'Edit White 2' }).click();
  await dialog.getByLabel('Stripe name').fill('White · 2 stripes');
  await dialog.getByLabel('Which classes count').selectOption('EACH_TYPE');
  await dialog.getByLabel('Fundamentals').first().check();
  await dialog.getByLabel('Sparring').first().check();
  await dialog.getByLabel('Fundamentals classes').fill('20');
  await dialog.getByLabel('Sparring classes').fill('10');
  await dialog.getByRole('button', { name: 'Close White · 2 stripes' }).click();

  await dialog.getByRole('button', { name: 'Edit White 0' }).click();
  await dialog.getByLabel(/Time in rank only/).check();
  await dialog.getByLabel('Min. years in rank').fill('2');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  const [w0, w1, w2] = await rungsOf('White');
  expect(w1.id).toBe((await db.studentRank.findFirstOrThrow({ where: { studentId: s.student.id } })).currentStripeId);
  expect(w0).toMatchObject({ timeOnly: true, minimumDaysInRank: 730 });
  expect(w2).toMatchObject({ name: 'White · 2 stripes', classCountMode: 'EACH_TYPE', eligibleClassTypes: ['Fundamentals', 'Sparring'] });
  expect(w2.classTypeRequirements).toEqual([
    { classType: 'Fundamentals', classesRequired: 20 },
    { classType: 'Sparring', classesRequired: 10 },
  ]);
  const skills = await db.rankStripeTierRequiredSkill.findMany({ where: { stripeTierId: w2.id } });
  expect(skills).toHaveLength(1); // kept
});

test('a rung nobody holds can be removed; a held one can\'t', async ({ page }) => {
  const before = await rungsOf('White');
  await page.goto(`/disciplines/${s.disciplineId}`);
  await page.getByRole('button', { name: 'Edit White' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit White' });
  await expect(dialog.getByRole('button', { name: "White 1 can't be removed: 1 student(s) on it" })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Remove White 2' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden(); // nobody's place changed: no confirmation
  expect((await rungsOf('White')).map((t) => t.id)).toEqual([before[0].id, before[1].id]);
});

test('reordering rungs names the students affected, and they keep their rung', async ({ page }) => {
  const before = await rungsOf('White');
  await page.goto(`/disciplines/${s.disciplineId}`);
  await page.getByRole('button', { name: 'Edit White' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit White' });
  await dialog.getByRole('button', { name: 'Move White 1 down' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();

  const confirm = page.getByRole('dialog', { name: 'Reorder stripes?' });
  await expect(confirm.getByText('Sam Lee')).toBeVisible();
  await confirm.getByRole('button', { name: 'Save' }).click();
  await expect(confirm).toBeHidden();

  expect((await rungsOf('White')).map((t) => t.id)).toEqual([before[0].id, before[2].id, before[1].id]);
  const sam = await db.studentRank.findFirstOrThrow({ where: { studentId: s.student.id } });
  expect(sam.currentStripeId).toBe(before[1].id);
});

test('adds a belt at the top of the ladder, with mixed stripe colours', async ({ page }) => {
  await page.goto(`/disciplines/${s.disciplineId}`);
  await page.getByRole('button', { name: 'Add rank' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add rank' });
  await dialog.getByLabel('Rank name').fill('Purple');
  await dialog.getByRole('button', { name: 'Add stripes' }).click();
  await dialog.getByRole('button', { name: 'Add stripes of another colour' }).click();
  await dialog.getByLabel('Number').nth(0).fill('2');
  await dialog.getByLabel('Number').nth(1).fill('1');
  await dialog.getByLabel('Classes required').fill('40');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  expect(await beltOrder()).toEqual(['White', 'Blue', 'Purple']);
  const [rung] = await rungsOf('Purple');
  expect(rung).toMatchObject({ count: 3, classesRequired: 40, name: 'Purple · 3 Stripes' });
  expect((rung.stripeSegments as Array<{ count: number }>).map((x) => x.count)).toEqual([2, 1]);
});

test('works with the keyboard only: move a belt and save', async ({ page }) => {
  await page.goto(`/disciplines/${s.disciplineId}`);
  const up = page.getByRole('button', { name: 'Move Blue up' });
  await expect(up).toBeVisible();
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    if (await up.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(up).toBeFocused();
  await page.keyboard.press('Enter');
  const save = page.getByRole('button', { name: 'Save order' });
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Shift+Tab');
    if (await save.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(save).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Reorder belts?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Save order' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  expect(await beltOrder()).toEqual(['Blue', 'White']);
});
