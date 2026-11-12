import { randomUUID } from 'crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { addPerson, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * The last old-look cards and drop-downs, in the new look (Decision 453, the
 * owner's 11 Nov 2026 rule "nothing from the old should be kept"): the
 * Students list's Freeze requests and Waiting for a Guardian cards, the
 * student page's App access (temporary passcode), and the header's School
 * switcher and language picker. Look only: each keeps its data, actions and
 * permission checks, which the specs for those features cover
 * (membership-freeze, student-access, coach- and owner-school-switcher, i18n).
 */
let s: GradingSchool;
const guardianIds: string[] = [];

const DAY = 24 * 60 * 60 * 1000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

/** A member's freeze request on a cash-paid Weekly Pass, as membership-freeze.spec.ts makes it. */
async function freezeRequest(studentId: string) {
  const plan = await db.membershipPlan.create({
    data: { id: randomUUID(), schoolId: s.schoolId, title: 'Four weeks', type: 'WEEKLY_PASS', price: 4000, currency: 'GBP', expiryDurationDays: 28 },
  });
  const m = await db.membership.create({
    data: { id: randomUUID(), studentId, membershipPlanId: plan.id, schoolId: s.schoolId, frequency: 'ONE_TIME', expiryDate: new Date(Date.now() + 20 * DAY) },
  });
  await db.membershipFreeze.create({
    data: {
      id: randomUUID(), membershipId: m.id, schoolId: s.schoolId, studentId, status: 'REQUESTED', requestedById: studentId,
      startsAt: new Date(`${day(0)}T00:00:00.000Z`), endsAt: new Date(`${day(8)}T00:00:00.000Z`),
    },
  });
}

/** A child waiting for a Guardian who already has an account (Decision 403). */
async function childInvite() {
  const guardian = await addPerson('Gina', 'Account');
  guardianIds.push(guardian.id);
  await db.childInvite.create({
    data: { id: randomUUID(), schoolId: s.schoolId, guardianId: guardian.id, childFirstName: 'Kit', childSurname: 'Young', childDateOfBirth: new Date('2016-03-04T00:00:00Z'), createdById: s.ownerId },
  });
}

/** The account the School made, not signed in to yet: App access shows on the student's page. */
async function unusedAccount(studentId: string) {
  await db.user.update({
    where: { id: studentId },
    data: { mustChangePasscode: true, temporaryPasscodeSchoolId: s.schoolId, temporaryPasscodeExpiresAt: new Date(Date.now() + 5 * DAY) },
  });
}

/** Every card here is a new-look card, with no old `Card` inside. */
async function expectNewLookCard(card: Locator) {
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/u8b-card/);
  await expect(card.locator('.ultm8-card')).toHaveCount(0);
  await expect(card.locator('select')).toHaveCount(0);
}

const shownValue = (combobox: Locator) => combobox.locator('[data-shown="true"]');

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.childInvite.deleteMany({ where });
  await db.membershipFreeze.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
  await db.childInvite.deleteMany({ where: { guardianId: { in: guardianIds } } });
});

test.afterAll(async () => {
  await cleanup();
});

test('the Students list: Freeze requests and Waiting for a Guardian are new-look cards, and their buttons still work', async ({ page }) => {
  await freezeRequest(s.student.id);
  await childInvite();
  await signIn(page, s.ownerToken);
  await page.goto('/students');

  const requests = page.locator('.u8n-notice .u8b-card').filter({ has: page.getByTestId('freeze-requests') });
  await expectNewLookCard(requests);
  await expect(requests.getByRole('heading', { name: 'Freeze requests' })).toHaveClass(/u8b-card__title/);
  await expect(requests).toContainText('wants to freeze Four weeks');
  // Approve and Decline: one equal pair of new-look pills.
  const approve = requests.getByRole('button', { name: 'Approve' });
  const decline = requests.getByRole('button', { name: 'Decline' });
  await expect(approve).toHaveClass(/u8b-pill/);
  await expect(decline).toHaveClass(/u8b-pill/);
  const [a, d] = [await approve.boundingBox(), await decline.boundingBox()];
  expect(Math.abs(a!.height - d!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(a!.y - d!.y)).toBeLessThanOrEqual(1);

  const waiting = page.getByRole('region', { name: 'Waiting for a Guardian' });
  await expectNewLookCard(page.locator('.u8n-notice .u8b-card').filter({ has: waiting }));
  await expect(waiting.getByRole('heading', { name: 'Waiting for a Guardian' })).toHaveClass(/u8b-card__title/);
  await expect(waiting.getByText('Kit Young, for Gina Account')).toBeVisible();
  await expect(waiting.getByRole('button', { name: 'Withdraw the invite for Kit Young' })).toHaveClass(/u8b-pill/);

  // No browser <select> anywhere on the page, header included.
  await expect(page.locator('select')).toHaveCount(0);

  // The actions are unchanged.
  await approve.click();
  await expect(page.getByRole('heading', { name: 'Freeze requests' })).toHaveCount(0);
  await waiting.getByRole('button', { name: 'Withdraw the invite for Kit Young' }).click();
  await expect(waiting).toHaveCount(0);
});

test('the student page: App access shows the new passcode in the panel\'s dashed ticket, with no old card', async ({ page }) => {
  await unusedAccount(s.student.id);
  await signIn(page, s.ownerToken);
  await page.goto(`/students/${s.student.id}`);

  const access = page.getByRole('region', { name: 'App access' });
  await expect(access).toBeVisible();
  await expect(access.locator('.ultm8-card')).toHaveCount(0);
  await expect(access.locator('select')).toHaveCount(0);
  await expect(access.getByText(`${s.student.name} hasn't signed in yet.`)).toBeVisible();
  await access.getByRole('button', { name: 'New temporary passcode' }).click();
  await expect(access.getByText(`New temporary passcode for ${s.student.name}:`)).toBeVisible();
  const code = access.getByTestId('temporary-passcode');
  await expect(code).toHaveText(/^\d{6}$/);
  await expect(access.locator('.u8sp-ticket')).toContainText(/^\d{6}$/);
  // The same ticket as the check-in code above it, no inline style.
  expect(await code.getAttribute('style')).toBeNull();
});

test('the header: a coach at two Schools switches School with the new-look drop-down, and the language picker is one too', async ({ page }) => {
  const s2 = await seedGradingSchool();
  const [firstId, secondId] = [s.schoolId, s2.schoolId].sort();
  const [first, second] = await Promise.all([
    db.school.findUniqueOrThrow({ where: { id: firstId } }),
    db.school.findUniqueOrThrow({ where: { id: secondId } }),
  ]);
  const coach = await addPerson('Cody', 'Coach', [
    { role: 'INSTRUCTOR', schoolId: s.schoolId },
    { role: 'INSTRUCTOR', schoolId: s2.schoolId },
  ]);
  // Only the second School has a class for this coach: the sign the switch worked.
  await db.timetableSlot.create({
    data: {
      id: randomUUID(), schoolId: secondId, instructorId: coach.id, weekday: 'TUESDAY', title: 'Kids BJJ',
      startTime: new Date('1970-01-01T17:00:00Z'), endTime: new Date('1970-01-01T18:00:00Z'),
    },
  });
  await signIn(page, coach.token);
  await page.goto('/coach');
  await expect(page.getByRole('heading', { name: 'Coach dashboard' })).toBeVisible();

  const bar = page.locator('.u8n-bar');
  await expect(bar.locator('select')).toHaveCount(0);
  await expect(page.locator('select')).toHaveCount(0);

  const switcher = bar.getByRole('combobox', { name: 'Switch School' });
  await expect(switcher).toHaveClass(/u8n-select__field/);
  await expect(shownValue(switcher)).toHaveText(first.name);
  // Its name is for screen readers only, as before: no visible label in the header.
  await expect(bar.locator('.u8n-bar__select .u8n-select__label').first()).toHaveCSS('position', 'absolute');

  // Opening the list doesn't make the header taller: it opens over the page.
  const before = (await bar.boundingBox())!.height;
  await switcher.click();
  const list = page.getByRole('listbox', { name: 'Switch School' });
  await expect(list.getByRole('option')).toHaveText([first.name, second.name]);
  expect((await bar.boundingBox())!.height).toBe(before);
  await list.getByRole('option', { name: second.name, exact: true }).click();
  await expect(list).toHaveCount(0);
  await expect(shownValue(switcher)).toHaveText(second.name);
  await expect(page.getByRole('region', { name: 'My classes' }).getByText(/Tuesday .*Kids BJJ/)).toBeVisible();

  // The language picker: the same drop-down, listing each language in its own script.
  const language = bar.getByRole('combobox', { name: 'Language' });
  await expect(language).toHaveClass(/u8n-select__field/);
  await language.click();
  await expect(page.getByRole('listbox', { name: 'Language' }).getByRole('option', { name: 'Português (Brasil)', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox', { name: 'Language' })).toHaveCount(0);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  async function fits(page: Page) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }

  test('the Students list\'s cards fit, with Approve and Decline sharing one row equally', async ({ page }) => {
    await freezeRequest(s.student.id);
    await childInvite();
    await signIn(page, s.ownerToken);
    await page.goto('/students');
    const requests = page.getByTestId('freeze-requests');
    await expect(requests).toBeVisible();
    await expect(page.getByRole('region', { name: 'Waiting for a Guardian' })).toBeVisible();
    await fits(page);

    const [a, d] = [await requests.getByRole('button', { name: 'Approve' }).boundingBox(), await requests.getByRole('button', { name: 'Decline' }).boundingBox()];
    expect(Math.abs(a!.width - d!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(a!.y - d!.y)).toBeLessThanOrEqual(1);
    expect(a!.height).toBeGreaterThanOrEqual(44);
    expect(a!.x + a!.width).toBeLessThanOrEqual(d!.x);
    expect(d!.x + d!.width).toBeLessThanOrEqual(390);
  });

  test('the student page\'s App access fits', async ({ page }) => {
    await unusedAccount(s.student.id);
    await signIn(page, s.ownerToken);
    await page.goto(`/students/${s.student.id}`);
    const access = page.getByRole('region', { name: 'App access' });
    await access.getByRole('button', { name: 'New temporary passcode' }).click();
    await expect(access.getByTestId('temporary-passcode')).toHaveText(/^\d{6}$/);
    await fits(page);
  });

  test('the header\'s School switcher fits and its list stays on screen', async ({ page }) => {
    const s2 = await seedGradingSchool();
    const owner = await addPerson('Olive', 'Owner', [
      { role: 'SCHOOL_OWNER_MANAGER', schoolId: s.schoolId },
      { role: 'SCHOOL_OWNER_MANAGER', schoolId: s2.schoolId },
    ]);
    await signIn(page, owner.token);
    await page.goto('/dashboard');
    const switcher = page.getByRole('combobox', { name: 'Switch School' });
    await expect(switcher).toBeVisible();
    await fits(page);
    await switcher.click();
    const list = page.getByRole('listbox', { name: 'Switch School' });
    await expect(list).toBeVisible();
    const box = (await list.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    // Each School on one line.
    const option = list.getByRole('option').first();
    expect((await option.boundingBox())!.height).toBeLessThanOrEqual(56);
    await fits(page);

    // The language picker's list stays on screen too.
    await page.keyboard.press('Escape');
    await page.getByRole('combobox', { name: 'Language' }).click();
    const languages = (await page.getByRole('listbox', { name: 'Language' }).boundingBox())!;
    expect(languages.x).toBeGreaterThanOrEqual(0);
    expect(languages.x + languages.width).toBeLessThanOrEqual(390);
    await fits(page);
  });
});
