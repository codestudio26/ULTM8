import { expect, test, type Locator } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Saved belt colours (backlog 3.18; DESIGN.md → "Colour choices"): every
 * colour row shows the presets, the School's saved colours and a "+" that
 * opens our own colour panel. Saved colours are shared by every row and
 * survive a reload; deleting one leaves a belt using it unchanged.
 *
 * Seed: BJJ, White (#FFFFFF, a preset) and Blue (#1E40AF, not a preset).
 */
let s: GradingSchool;

test.beforeEach(async ({ page }) => {
  s = await seedGradingSchool();
  await signIn(page, s.ownerToken);
});

test.afterAll(async () => {
  await cleanup();
});

const savedColours = async () => (await db.school.findUniqueOrThrow({ where: { id: s.schoolId }, select: { savedBeltColours: true } })).savedBeltColours;
const baseRow = (dialog: Locator) => dialog.getByRole('group', { name: 'Base colour' });

test('a belt\'s own colour can be saved, then shows in every colour row', async ({ page }) => {
  await page.goto(`/disciplines/${s.disciplineId}`);
  await page.getByRole('button', { name: 'Edit Blue' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Blue' });
  await expect(baseRow(dialog).getByText('Custom colour #1E40AF · not saved')).toBeVisible();
  await baseRow(dialog).getByRole('button', { name: 'Save #1E40AF to saved colours' }).click();
  await expect(baseRow(dialog).getByRole('button', { name: 'Delete' })).toBeVisible();
  await expect.poll(savedColours).toEqual(['#1E40AF']);
  // The same saved colour is offered in the tag colour row.
  await expect(dialog.getByRole('group', { name: 'Tag colour (optional)' }).getByRole('button', { name: 'Saved colour #1E40AF' })).toBeVisible();
});

test('"+" opens the colour panel; a wrong code keeps Save off; Save colour applies and saves it', async ({ page }) => {
  await page.goto(`/disciplines/${s.disciplineId}`);
  await page.getByRole('button', { name: 'Edit White' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit White' });
  const tag = dialog.getByRole('group', { name: 'Tag colour (optional)' });
  await tag.getByRole('button', { name: 'Add a colour' }).click();
  await tag.getByLabel('Colour code').fill('#2A9D8');
  await expect(tag.getByText('Use a colour code like #2A9D8F.')).toBeVisible();
  await expect(tag.getByRole('button', { name: 'Save colour' })).toBeDisabled();
  // Picking on the wheel at full brightness: the centre is white.
  await tag.getByLabel('Brightness').fill('100');
  await tag.getByRole('img', { name: 'Colour wheel' }).click();
  await expect(tag.getByLabel('Colour code')).toHaveValue('#FFFFFF');
  await tag.getByLabel('Colour code').fill('#2a9d8f');
  await tag.getByRole('button', { name: 'Save colour' }).click();
  await expect(tag.getByText('Custom colour #2A9D8F')).toBeVisible();
  // The panel closes on Save colour.
  await expect(tag.getByLabel('Colour code')).toHaveCount(0);
  await expect.poll(savedColours).toEqual(['#2A9D8F']);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await db.rank.findFirstOrThrow({ where: { disciplineId: s.disciplineId, name: 'White' } })).tagColour).toBe('#2A9D8F');

  // After a reload the saved colour is still offered, here in Add rank.
  await page.reload();
  await page.getByRole('button', { name: 'Add rank' }).click();
  await expect(baseRow(page.getByRole('dialog', { name: 'Add rank' })).getByRole('button', { name: 'Saved colour #2A9D8F' })).toBeVisible();
});

test('Delete removes a saved colour only; the belt keeps it', async ({ page }) => {
  await db.school.update({ where: { id: s.schoolId }, data: { savedBeltColours: ['#1E40AF', '#2A9D8F'] } });
  await page.goto(`/disciplines/${s.disciplineId}`);
  await page.getByRole('button', { name: 'Edit Blue' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Blue' });
  await expect(baseRow(dialog).getByText('Custom colour #1E40AF', { exact: true })).toBeVisible();
  await baseRow(dialog).getByRole('button', { name: 'Delete' }).click();
  await expect(baseRow(dialog).getByText('Custom colour #1E40AF · not saved')).toBeVisible();
  await expect.poll(savedColours).toEqual(['#2A9D8F']);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await db.rank.findFirstOrThrow({ where: { disciplineId: s.disciplineId, name: 'Blue' } })).primaryColour).toBe('#1E40AF');
});
