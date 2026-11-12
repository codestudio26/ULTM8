import { randomUUID } from 'crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { addBranch, addCoach, addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';
import { pickOption } from './team-helpers';

/**
 * The Team forms in the new look (Decision 460): the Instructors and Staff
 * dialogs in the shared dialog frame with their buttons in the band at the
 * foot (Cancel first), the new look's own drop-downs instead of browser
 * `<select>`s (a pick counts as an edit, as a browser select's change did),
 * belt pictures in the Correct belt picker, and "My coach profile" and the
 * old coach-invites address with the new page header. Look only: the same
 * fields, checks and API calls, which the instructors, staff and
 * instructor-belts specs still cover.
 */
let s: GradingSchool;

test.beforeEach(async () => {
  s = await seedGradingSchool(); // BJJ: White 0–2, Blue 0
});

test.afterEach(async () => {
  await db.class.deleteMany({ where: { schoolId: s.schoolId } });
  await db.instructorBelt.deleteMany({ where: { schoolId: s.schoolId } });
  await db.instructor.deleteMany({ where: { schoolId: s.schoolId } });
});

test.afterAll(async () => {
  await cleanup();
});

const band = (dialog: Locator) => dialog.locator('.ultm8-modal__actions').getByRole('button');
const closeButton = (dialog: Locator) => dialog.locator('.ultm8-modal__head').getByRole('button', { name: 'Close dialog' });

/** The band is the dialog's last row: nothing comes after it. */
async function expectBandLast(dialog: Locator) {
  const last = dialog.locator('.ultm8-modal__body').locator(':scope > *, :scope > form > *').last();
  await expect(last).toHaveClass(/ultm8-modal__actions/);
}

async function addProfile(first: string, last: string) {
  const coach = await addCoach(s, first, last);
  const profile = await db.instructor.create({ data: { id: randomUUID(), userId: coach.id, schoolId: s.schoolId } });
  return { ...coach, profileId: profile.id };
}

async function openFromInstructors(page: Page, button: string, dialogName: string | RegExp) {
  await page.goto('/instructors');
  await page.getByRole('button', { name: button, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: dialogName });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('Add instructor: new-look drop-downs, Cancel then Save in the band, and a pick counts as an edit', async ({ page }) => {
  await addBranch(s, 'North');
  await addCoach(s, 'Pia', 'Picked');
  await signIn(page, s.ownerToken);
  const dialog = await openFromInstructors(page, 'Add instructor', /Add instructor/);

  await expect(dialog.locator('select')).toHaveCount(0);
  await expect(dialog.getByRole('combobox')).toHaveCount(2);
  await expect(band(dialog)).toHaveText(['Cancel', 'Save']);
  await expectBandLast(dialog);
  // There is no browser `required` check on the drop-down: Save waits for a pick.
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();

  await pickOption(dialog, 'User', `Pia Picked (${(await db.user.findFirstOrThrow({ where: { firstName: 'Pia', surname: 'Picked' } })).email})`);
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled();
  // The pick is an edit: Escape and a click outside keep the form.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  // The ✕ does what Cancel does.
  await closeButton(dialog).click();
  await expect(dialog).toHaveCount(0);
  expect(await db.instructor.count({ where: { schoolId: s.schoolId } })).toBe(0);
});

test('Add manually and Invite existing user: drop-downs and the band, and the branch still has to be chosen', async ({ page }) => {
  await addBranch(s, 'North');
  const existing = await addPerson('Ivy', 'Existing', [{ role: 'STUDENT', schoolId: s.schoolId }]);
  await signIn(page, s.ownerToken);

  let dialog = await openFromInstructors(page, 'Add manually', 'Add instructor manually');
  await expect(dialog.locator('select')).toHaveCount(0);
  await expect(band(dialog)).toHaveText(['Add instructor']);
  await expectBandLast(dialog);
  await dialog.getByLabel('First name').fill('Nora');
  await dialog.getByLabel('Surname').fill('Branchless');
  await dialog.getByLabel('Email', { exact: false }).fill(`nora.${randomUUID()}@example.test`);
  await dialog.getByRole('button', { name: 'Add instructor' }).click();
  await expect(dialog.getByText('Select the Branch this Instructor belongs to.')).toBeVisible();
  await closeButton(dialog).click();
  await expect(dialog).toHaveCount(0);

  dialog = await openFromInstructors(page, 'Invite existing user', 'Invite to Instructor role');
  await expect(band(dialog)).toHaveText(['Find']);
  await dialog.getByLabel('Email').fill(existing.email);
  await dialog.getByRole('button', { name: 'Find' }).click();
  await expect(dialog.locator('select')).toHaveCount(0);
  await expect(band(dialog)).toHaveText(['Search again', 'Grant Instructor role']);
  await expectBandLast(dialog);
  await pickOption(dialog, 'Branch', 'North');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
});

test("a team member's full page: Hand over, Resend passcode and the revoke notice have their buttons in the band", async ({ page }) => {
  const leaving = await addProfile('Lea', 'Leaving');
  await addProfile('Tom', 'Takeover');
  await db.user.update({ where: { id: leaving.id }, data: { mustChangePasscode: true } });
  await db.class.create({
    data: {
      id: randomUUID(), schoolId: s.schoolId, instructorId: leaving.id, title: 'Still teaching',
      startDate: new Date(Date.now() + 86_400_000), endDate: new Date(Date.now() + 90_000_000),
    },
  });
  await signIn(page, s.ownerToken);
  await page.goto(`/instructors/${leaving.profileId}`);

  await page.getByRole('button', { name: 'Hand over classes' }).click();
  let dialog = page.getByRole('dialog', { name: "Hand over Lea Leaving's classes" });
  await expect(dialog.locator('select')).toHaveCount(0);
  await expect(band(dialog)).toHaveText(['Hand over']);
  await expect(dialog.getByRole('button', { name: 'Hand over' })).toBeDisabled();
  await pickOption(dialog, 'New instructor', 'Tom Takeover');
  await expect(dialog.getByRole('button', { name: 'Hand over' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await closeButton(dialog).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Resend passcode' }).click();
  dialog = page.getByRole('dialog', { name: 'Send Lea Leaving a new temporary passcode?' });
  await expect(band(dialog)).toHaveText(['Cancel', 'Send new passcode']);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Revoke enrollment' }).click();
  dialog = page.getByRole('dialog', { name: 'Lea Leaving still teaches classes' });
  await expect(band(dialog)).toHaveText(['Cancel', 'Hand over classes']);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('Correct a belt: belt pictures in the picker and in every option, and a pick counts as an edit', async ({ page }) => {
  const coach = await addPerson('Cody', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await db.instructorBelt.create({
    data: { id: randomUUID(), schoolId: s.schoolId, userId: coach.id, disciplineId: s.disciplineId, rankId: s.rung['White 1'].rankId, stripeTierId: s.rung['White 1'].id },
  });
  await signIn(page, s.ownerToken);
  await page.goto('/instructors');
  const section = page.locator('.u8t-card', { has: page.getByRole('heading', { name: 'Belts', exact: true }) });
  await section.getByRole('button', { name: "Correct Cody Coach's BJJ belt" }).click();
  const dialog = page.getByRole('dialog', { name: "Cody Coach's BJJ belt" });

  await expect(dialog.locator('select')).toHaveCount(0);
  await expect(band(dialog)).toHaveText(['Cancel', 'Save and verify']);
  await expectBandLast(dialog);
  const picker = dialog.getByRole('combobox', { name: 'Belt' });
  await expect(picker).toHaveText(/White 1/);
  // The closed field and each option carry the belt picture.
  await expect(picker.locator('span[aria-hidden="true"][style*="background"]')).toHaveCount(1);
  await picker.click();
  const options = dialog.getByRole('option');
  await expect(options).toHaveText([/White 0/, /White 1/, /White 2/, /Blue 0/]);
  for (const option of await options.all()) {
    await expect(option.locator('span[aria-hidden="true"][style*="background"]')).toHaveCount(1);
  }
  await dialog.getByRole('option', { name: 'Blue 0' }).click();
  await expect(picker).toHaveText(/Blue 0/);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  // Nothing was saved.
  expect((await db.instructorBelt.findFirstOrThrow({ where: { userId: coach.id } })).stripeTierId).toBe(s.rung['White 1'].id);
});

test('Staff: the give-a-role form, Add staff manually and Remove from School use the new drop-downs and band', async ({ page }) => {
  await addBranch(s, 'North');
  const tara = await addPerson('Tara', 'Target');
  const ana = await addProfile('Ana', 'Coach');
  await addProfile('Ben', 'Coach');
  await db.class.create({
    data: {
      id: randomUUID(), schoolId: s.schoolId, instructorId: ana.id, title: 'Ana teaches',
      startDate: new Date(Date.now() + 86_400_000), endDate: new Date(Date.now() + 90_000_000),
    },
  });
  await signIn(page, s.ownerToken);
  await page.goto('/staff');
  await expect(page.locator('.u8n-page select')).toHaveCount(0);

  const card = page.locator('.u8t-card', { has: page.getByRole('heading', { name: 'Give a role' }) });
  await card.getByLabel('Email').fill(tara.email);
  await card.getByRole('button', { name: 'Find' }).click();
  await expect(card.locator('select')).toHaveCount(0);
  await pickOption(card, 'Role', 'Branch Staff');
  // The branch is still checked before anything is sent.
  await card.getByRole('button', { name: 'Give role' }).click();
  await expect(card.getByText('Select a Branch for Branch Staff.')).toBeVisible();
  expect(await db.roleGrant.count({ where: { userId: tara.id } })).toBe(0);

  await page.getByRole('button', { name: 'Add staff manually' }).click();
  let dialog = page.getByRole('dialog', { name: 'Add staff manually' });
  await expect(dialog.locator('select')).toHaveCount(0);
  await expect(band(dialog)).toHaveText(['Add staff']);
  await expectBandLast(dialog);
  await pickOption(dialog, 'Branch', 'North');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await closeButton(dialog).click();
  await expect(dialog).toHaveCount(0);

  const row = page.locator('.u8t-card').getByRole('row', { name: /Ana Coach/ });
  await row.getByRole('button', { name: 'Actions for Ana Coach' }).click();
  await page.getByRole('menuitem', { name: 'Remove from School' }).click();
  dialog = page.getByRole('dialog', { name: /Remove Ana Coach/ });
  await expect(band(dialog)).toHaveText(['Cancel', 'Remove from School']);
  await expectBandLast(dialog);
  await dialog.getByRole('radio', { name: /^Give them to another coach/ }).click();
  await expect(dialog.locator('select')).toHaveCount(0);
  await pickOption(dialog, 'New coach', 'Ben Coach');
  await expect(dialog.getByRole('button', { name: 'Remove from School' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('Invite coaches has no browser drop-down; Staff access presets are pills', async ({ page }) => {
  await addBranch(s, 'North');
  await addPerson('Bea', 'Desk', [{ role: 'BRANCH_STAFF', schoolId: s.schoolId }]);
  await signIn(page, s.ownerToken);
  await page.goto('/team/invite-coaches');
  await expect(page.getByRole('combobox', { name: 'Branch', exact: true })).toBeVisible();
  await expect(page.locator('.u8n-page select')).toHaveCount(0);

  await page.goto('/staff');
  const row = page.locator('.u8t-card').getByRole('row', { name: /Bea Desk/ });
  await row.getByRole('button', { name: 'Actions for Bea Desk' }).click();
  await page.getByRole('menuitem', { name: 'Access' }).click();
  const dialog = page.getByRole('dialog', { name: /Bea Desk/ });
  const presets = dialog.getByRole('group', { name: 'Presets:' });
  await expect(presets.locator('.ultm8-pills__option')).toHaveText(['Front desk', 'Branch manager']);
  await presets.getByRole('button', { name: 'Front desk' }).click();
  await expect(presets.getByRole('button', { name: 'Front desk' })).toHaveAttribute('aria-pressed', 'true');
  await expect(band(dialog)).toHaveText(['Cancel', 'Save']);
});

test('My coach profile and the old coach-invites address have the new page header', async ({ page }) => {
  const coach = await addPerson('Cleo', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await db.instructor.create({ data: { id: randomUUID(), userId: coach.id, schoolId: s.schoolId } });
  await signIn(page, coach.token);
  await page.goto('/complete-instructor-profile');
  await expect(page.locator('.u8n-page-header').getByRole('heading', { level: 1, name: 'My coach profile' })).toBeVisible();
  await expect(page.locator('.ultm8-page-header')).toHaveCount(0);
  for (const chapter of ['Personal details', 'Address', 'Certification']) {
    await expect(page.getByRole('heading', { level: 2, name: chapter, exact: true })).toBeVisible();
  }
  // The address's Country and Region pickers are the shared address fields
  // (a later, shared change); nothing else on the form is a browser select.
  await expect(page.locator('.u8f-sheet select:not(.ultm8-address select)')).toHaveCount(0);

  await page.goto('/coach-invites');
  await expect(page.locator('.u8n-page-header').getByRole('heading', { level: 1, name: 'Invite coaches' })).toBeVisible();
  await expect(page.locator('.ultm8-page-header')).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a Team dialog fills the screen with its band in view, and My coach profile fits', async ({ page }) => {
    await addBranch(s, 'North');
    await signIn(page, s.ownerToken);
    await page.goto('/staff');
    await page.getByRole('button', { name: 'Add staff manually' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add staff manually' });
    const actions = dialog.locator('.ultm8-modal__actions');
    await expect(actions).toBeInViewport();
    const box = await actions.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    const coach = await addPerson('Phoebe', 'Phone', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
    await db.instructor.create({ data: { id: randomUUID(), userId: coach.id, schoolId: s.schoolId } });
    await signIn(page, coach.token);
    await page.goto('/complete-instructor-profile');
    await expect(page.getByRole('heading', { level: 1, name: 'My coach profile' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  });
});
