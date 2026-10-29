import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { addStudent, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Kids and Adult programs (backlog 3.20): a Kids style links to its Adult
 * style, the board tags students old enough to move up and switches between
 * the two, and the Grade dialog offers the Adult belts after the first one.
 *
 * Seed: BJJ (the Kids style) as in seedGradingSchool, plus "BJJ Adult" with
 * White, Blue and Purple. Every seeded person was born in 2000.
 */
let s: GradingSchool;
let adultId: string;
let adultRung: Record<string, string>;
let ben: { id: string; name: string };

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  const adult = await db.discipline.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'BJJ Adult', classTypesOffered: [] } });
  adultId = adult.id;
  adultRung = {};
  for (const [order, name] of ['White', 'Blue', 'Purple'].entries()) {
    const rank = await db.rank.create({ data: { id: randomUUID(), disciplineId: adult.id, schoolId: s.schoolId, order, name, primaryColour: '#888888' } });
    const tier = await db.rankStripeTier.create({
      data: { id: randomUUID(), rankId: rank.id, schoolId: s.schoolId, order: 0, count: 0, colour: '#000000', name, stripeSegments: [], classesRequired: 3 },
    });
    adultRung[name] = tier.id;
  }
  ben = await addStudent(s, 'Ben', 'Ortiz', { rung: 'White 0', classes: 1, activeOverride: true });
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

const link = () => db.discipline.update({ where: { id: s.disciplineId }, data: { adultDisciplineId: adultId } });

test('Edit discipline links a Kids style to its Adult program', async ({ page }) => {
  await page.goto('/disciplines');
  await page.getByRole('row', { name: /^BJJ(?! Adult)/ }).getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit discipline' });
  await dialog.getByLabel('Adult program (for a Kids style)').selectOption({ label: 'BJJ Adult' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await db.discipline.findUniqueOrThrow({ where: { id: s.disciplineId } })).adultDisciplineId).toBe(adultId);

  // The Adult style can't be a Kids style itself.
  await page.getByRole('row', { name: /BJJ Adult/ }).getByRole('button', { name: 'Edit' }).click();
  await expect(dialog.getByText("This style is the Adult program of a Kids style, so it can't be a Kids style itself.")).toBeVisible();
  await expect(dialog.getByLabel('Adult program (for a Kids style)')).toHaveCount(0);
});

test('the board tags students old enough for Adult and switches Kids · Adult', async ({ page }) => {
  await link();
  await page.goto('/grading');
  const program = page.getByRole('group', { name: 'Program' });
  await expect(program.getByRole('button', { name: 'Kids' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('listitem', { name: ben.name }).getByText('Ready for Adult program')).toBeVisible();

  await program.getByRole('button', { name: 'Adult' }).click();
  await expect(program.getByRole('button', { name: 'Adult' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('listitem', { name: ben.name })).toHaveCount(0);

  // Raised past their age, nobody is tagged.
  await db.discipline.update({ where: { id: s.disciplineId }, data: { readyForAdultAge: 40 } });
  await program.getByRole('button', { name: 'Kids' }).click();
  await expect(page.getByRole('listitem', { name: ben.name })).toBeVisible();
  await expect(page.getByText('Ready for Adult program')).toHaveCount(0);
});

const bjj = (page: Page) => page.getByRole('region', { name: 'BJJ', exact: true });

test('Grade on the Ranks tab moves a student into the Adult program', async ({ page }) => {
  await link();
  await page.goto(`/students/${ben.id}`);
  const card = bjj(page);
  await expect(card.getByText('Ready for Adult program')).toBeVisible();
  await card.getByRole('button', { name: 'Grade', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Grade — BJJ' });
  await dialog.getByRole('combobox', { name: 'New rank' }).click();
  await expect(dialog.getByText('Adult program', { exact: true })).toBeVisible();
  // The Adult ladder's first belt is never offered.
  await expect(dialog.getByRole('option', { name: /^White · Adult program/ })).toHaveCount(0);
  await dialog.getByRole('option', { name: /^Blue\b.*Adult program/ }).click();
  await expect(dialog.getByRole('note')).toHaveText('Moves to the Adult program. This is recorded on the history.');
  await dialog.getByRole('button', { name: 'Grade' }).click();
  await expect(dialog).toHaveCount(0);

  const rank = await db.studentRank.findFirstOrThrow({ where: { studentId: ben.id } });
  expect(rank).toMatchObject({ disciplineId: adultId, currentStripeId: adultRung.Blue, classesAttendedTowardCheckpoint: 0 });
  await expect(page.getByRole('region', { name: 'BJJ Adult' })).toBeVisible();
});
