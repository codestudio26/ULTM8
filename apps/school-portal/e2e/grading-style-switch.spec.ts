import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { addStudent, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 462 items 10, 11 and 12:
 * - the style picker is the style switch (a grey track, one button per style,
 *   the chosen one pressed) on the Board, Skills and Settings, never a
 *   drop-down, and many styles still fit a phone without sideways scroll;
 * - Grading → Settings shows one style at a time, picked with that switch,
 *   and "Ranks shown as" is a Belts · Levels two-button switch; an edit to one
 *   style survives switching to another, and Save sends it;
 * - "Currently attending only" on the Board is an on/off switch that hides
 *   inactive students, as the tick box did.
 *
 * Seed: BJJ (Sam Lee, no membership, so inactive) plus Judo; Cat on BJJ,
 * marked attending.
 */
let s: GradingSchool;
let judoId: string;
let cat: { id: string; name: string };

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  judoId = (await db.discipline.create({ data: { id: randomUUID(), schoolId: s.schoolId, name: 'Judo', classTypesOffered: [] } })).id;
  cat = await addStudent(s, 'Cat', 'Ng', { rung: 'White 0', classes: 1, activeOverride: true });
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

const styleSwitch = (page: Page) => page.getByRole('group', { name: 'Style', exact: true });
const styleButton = (page: Page, name: string) => styleSwitch(page).getByRole('button', { name, exact: true });
const unsavedBar = (page: Page) => page.getByRole('region', { name: 'You have unsaved changes.' });

async function fitsTheScreen(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

for (const path of ['/grading', '/grading/skills', '/grading/settings']) {
  test(`${path}: the style is picked with the style switch, not a drop-down`, async ({ page }) => {
    await page.goto(path);
    await expect(styleSwitch(page).getByRole('button')).toHaveText(['BJJ', 'Judo']);
    await expect(styleButton(page, 'BJJ')).toHaveAttribute('aria-pressed', 'true');
    await expect(styleButton(page, 'Judo')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('combobox', { name: 'Style', exact: true })).toHaveCount(0);
    await styleButton(page, 'Judo').click();
    await expect(styleButton(page, 'Judo')).toHaveAttribute('aria-pressed', 'true');
    await expect(styleButton(page, 'BJJ')).toHaveAttribute('aria-pressed', 'false');
  });
}

test('Settings shows one style at a time; an edit survives switching and Save sends it', async ({ page }) => {
  await page.goto('/grading/settings');
  // Only BJJ's settings show, and each style card's heading names it.
  await expect(page.getByRole('heading', { name: 'How ranks are shown · BJJ' })).toBeVisible();
  await expect(page.getByLabel('BJJ: "Getting There" from (%)')).toBeVisible();
  await expect(page.getByLabel('Judo: "Getting There" from (%)')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Judo: ranks shown as' })).toHaveCount(0);

  // Belts · Levels is a two-button switch; picking Levels on BJJ is an edit.
  const bjjDisplay = page.getByRole('group', { name: 'BJJ: ranks shown as' });
  await expect(bjjDisplay.getByRole('button')).toHaveText(['Belts', 'Levels (no belt)']);
  await bjjDisplay.getByRole('button', { name: 'Levels (no belt)' }).click();
  await expect(unsavedBar(page)).toBeVisible();

  // Switch to Judo: only Judo's settings show; BJJ's edit is kept (the bar stays).
  await styleButton(page, 'Judo').click();
  await expect(page.getByRole('heading', { name: 'How ranks are shown · Judo' })).toBeVisible();
  await expect(page.getByLabel('BJJ: "Getting There" from (%)')).toHaveCount(0);
  await page.getByLabel('Judo: "Getting There" from (%)').fill('40');
  await expect(unsavedBar(page)).toBeVisible();

  await styleButton(page, 'BJJ').click();
  await expect(bjjDisplay.getByRole('button', { name: 'Levels (no belt)' })).toHaveAttribute('aria-pressed', 'true');

  await unsavedBar(page).getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect.poll(async () => (await db.discipline.findUniqueOrThrow({ where: { id: s.disciplineId } })).rankDisplay).toBe('LEVELS');
  await expect.poll(async () => (await db.discipline.findUniqueOrThrow({ where: { id: judoId } })).boardGettingThere).toBe(40);
});

test('"Currently attending only" is an on/off switch that hides inactive students', async ({ page }) => {
  await page.goto('/grading');
  const attending = page.getByRole('switch', { name: 'Currently attending only' });
  await expect(page.getByRole('checkbox', { name: 'Currently attending only' })).toHaveCount(0);
  await expect(attending).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('listitem', { name: s.student.name })).toBeVisible();

  await attending.click();
  await expect(attending).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('listitem', { name: s.student.name })).toHaveCount(0);
  await expect(page.getByText('1 inactive hidden')).toBeVisible();
  await expect(page.getByRole('listitem', { name: cat.name })).toBeVisible();

  await attending.click();
  await expect(attending).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('listitem', { name: s.student.name })).toBeVisible();
});

test('on a phone many styles wrap inside the switch: no sideways page scroll', async ({ page }) => {
  for (const name of ['Brazilian Jiu-Jitsu Fundamentals', 'Muay Thai', 'Kickboxing', 'Wrestling', 'Kids Brazilian Jiu-Jitsu', 'Karate', 'Taekwondo']) {
    await db.discipline.create({ data: { id: randomUUID(), schoolId: s.schoolId, name, classTypesOffered: [] } });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/grading', '/grading/skills', '/grading/settings']) {
    await page.goto(path);
    await expect(styleSwitch(page).getByRole('button')).toHaveCount(9);
    expect(await fitsTheScreen(page)).toBe(true);
    const track = await styleSwitch(page).boundingBox();
    expect(track!.x).toBeGreaterThanOrEqual(0);
    expect(track!.x + track!.width).toBeLessThanOrEqual(390);
    // Every style is reachable on screen width: the last one too.
    const last = await styleButton(page, 'Taekwondo').boundingBox();
    expect(last!.x + last!.width).toBeLessThanOrEqual(390);
  }
});
