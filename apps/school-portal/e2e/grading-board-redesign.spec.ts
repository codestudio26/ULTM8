import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { addStudent, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The New Portal Grading Board (DESIGN.md → "Grading screens"): Grading's
 * tabs, the student panel, Rows and sorting, promoting from a progress bar
 * with our own "Promote to" drop-down, the Selection panel and its pill, and
 * a declined promotion fee that the owner cancels, leaving it for a coach.
 */
let s: GradingSchool;
let ben: { id: string; name: string };
let cat: { id: string; name: string };

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  ben = await addStudent(s, 'Ben', 'Ortiz', { rung: 'White 0', classes: 0, activeOverride: true }); // 0%
  cat = await addStudent(s, 'Cat', 'Ng', { rung: 'White 0', classes: 1, activeOverride: true }); // 33%
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

const card = (page: Page, name: string) => page.getByRole('listitem', { name });

test('Grading has its tabs, and the old Permissions address still works', async ({ page }) => {
  await page.goto('/grading');
  const tabs = page.getByRole('navigation', { name: 'Grading' });
  await expect(tabs.getByRole('link', { name: 'Board' })).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('link', { name: 'Permissions' }).click();
  await expect(page).toHaveURL(/\/grading\/permissions$/);
  await page.goto('/grading-permissions');
  await expect(page).toHaveURL(/\/grading\/permissions$/);
});

test('clicking a card opens the student panel; ✕ closes it', async ({ page }) => {
  await page.goto('/grading');
  await card(page, cat.name).getByText('White 0').click();
  const panel = page.getByRole('region', { name: `${cat.name}: grading` });
  await expect(panel.getByRole('heading', { name: 'Toward White 1' })).toBeVisible();
  await expect(panel.getByText('Classes: 1 of 3')).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Open student page ›' })).toBeVisible();
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toHaveCount(0);
});

test('Rows puts Ready to Grade on top, and Name sorts each stage', async ({ page }) => {
  await addStudent(s, 'Al', 'Zed', { rung: 'White 0', classes: 0, activeOverride: true });
  await page.goto('/grading');
  await page.getByRole('button', { name: 'Rows' }).click();
  const groups = page.getByRole('region', { name: /^(Ready to Grade|Getting There|Just Starting)$/ });
  await expect(groups.nth(0)).toHaveAttribute('aria-label', 'Ready to Grade');
  await expect(groups.nth(2)).toHaveAttribute('aria-label', 'Just Starting');

  const starting = page.getByRole('region', { name: 'Just Starting' }).getByRole('listitem');
  await page.getByRole('button', { name: 'Name', exact: true }).click();
  await expect(starting.nth(0)).toHaveAttribute('aria-label', ben.name); // Ortiz before Zed
  await page.getByRole('button', { name: /Sort direction/ }).click();
  await expect(starting.nth(0)).toHaveAttribute('aria-label', 'Al Zed');
});

test('a progress bar opens "Promote {name}"; picking a higher rank skips one', async ({ page }) => {
  await page.goto('/grading');
  await card(page, cat.name).getByRole('button', { name: `Promote ${cat.name}` }).click();
  const dialog = page.getByRole('dialog', { name: `Promote ${cat.name}` });
  const picker = dialog.getByRole('combobox', { name: 'New rank' });
  await expect(picker).toHaveText(/White 1/);
  await picker.click();
  await dialog.getByRole('option', { name: 'White 2' }).click();
  await expect(picker).toHaveText(/White 2/);
  await expect(dialog.getByText(/Skips 1 rank/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Grade' }).click();
  await expect(dialog).toHaveCount(0);
  const event = await db.promotionEvent.findFirstOrThrow({ where: { studentId: cat.id, type: 'PROMOTION' } });
  expect(event).toMatchObject({ toStripeTierId: s.rung['White 2'].id, rungsSkipped: 1 });
});

test('ticking opens the Selection panel; – makes it a pill that opens it again', async ({ page }) => {
  await page.goto('/grading');
  await page.getByLabel(`Select ${ben.name}`).check();
  const selection = page.getByRole('region', { name: 'Selection' });
  await expect(selection.getByText('1 selected')).toBeVisible();
  await selection.getByRole('button', { name: 'Make the selection small' }).click();
  await expect(selection).toHaveCount(0);
  const pill = page.getByRole('region', { name: 'Selected students' });
  await pill.getByRole('button', { name: /1 selected/ }).click();
  await expect(page.getByRole('region', { name: 'Selection' })).toBeVisible();
  await page.getByRole('button', { name: `Take ${ben.name} out of the selection` }).click();
  await expect(page.getByRole('region', { name: 'Selection' })).toHaveCount(0);
  await expect(page.getByLabel(`Select ${ben.name}`)).not.toBeChecked();
});

test('a declined fee: the owner cancels it, and the promotion is left for a coach', async ({ page }) => {
  await db.promotionFeeRequest.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      studentId: ben.id,
      disciplineId: s.disciplineId,
      toRungId: s.rung['White 1'].id,
      toRungName: 'White 1',
      expectedCurrentRungId: s.rung['White 0'].id,
      amountMinor: 4000,
      currency: 'GBP',
      status: 'DECLINED',
      promotionWaits: true,
      declinedAt: new Date(),
    },
  });
  await page.goto('/grading');
  await expect(card(page, ben.name).getByText('Fee declined')).toBeVisible();
  await card(page, ben.name).getByText('White 0').click();
  const panel = page.getByRole('region', { name: `${ben.name}: grading` });
  await expect(panel.getByText(/40\.00 GBP · White 1/)).toBeVisible();
  await panel.getByRole('button', { name: 'Cancel fee' }).click();

  const decide = page.getByRole('dialog', { name: `Promote ${ben.name}?` });
  await expect(decide.getByText('The fee for White 1 was cancelled.')).toBeVisible();
  await decide.getByRole('button', { name: 'Not now' }).click();
  await expect(card(page, ben.name).getByText('Promotion to decide')).toBeVisible();

  await panel.getByRole('button', { name: "Don't promote" }).click();
  await expect(card(page, ben.name).getByText('Promotion to decide')).toHaveCount(0);
  const request = await db.promotionFeeRequest.findFirstOrThrow({ where: { studentId: ben.id } });
  expect(request.status).toBe('CANCELLED');
  expect(request.toDecideResolvedAt).not.toBeNull();
  expect(await db.promotionEvent.count({ where: { studentId: ben.id, type: { in: ['PROMOTION', 'STRIPE_AWARD'] } } })).toBe(0);
});
