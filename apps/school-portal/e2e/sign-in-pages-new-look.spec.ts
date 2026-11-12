import { createHash, createHmac, randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { expect, test, type Page, type Request } from '@playwright/test';
import { addCoachInvite, cleanup, db, seedGradingSchool, type GradingSchool } from './fixtures';

/**
 * The pages outside the app shell in the new look (Decision 453 / 460): Log
 * in, Create account, Verify phone, Forgot / Reset passcode, First-login
 * passcode, Accept the Terms, the coach invite link and the guest waiver
 * link. Each shows the new look's white card on the grey page (no old
 * AuthCard, no browser <select>), in light and dark mode and at phone width,
 * and each still completes as before, with the same fields, autocomplete
 * attributes and request bodies.
 *
 * Sending and checking a text-message code needs Twilio, which the test
 * environment doesn't have, so for Create account, Verify phone and Forgot /
 * Reset passcode the four Twilio-backed calls are answered here; the test
 * still checks exactly what the page sends. Everything else uses the real API.
 */
const PASSCODE = '123456';
const NEW_PASSCODE = '246810';
const userIds: string[] = [];
let s: GradingSchool;

test.beforeAll(async () => {
  s = await seedGradingSchool();
});

test.afterAll(async () => {
  const where = { schoolId: s.schoolId };
  await db.guestWaiverSignature.deleteMany({ where });
  await db.bookingAttendee.deleteMany({ where });
  await db.booking.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
  await db.class.deleteMany({ where });
  await db.waiver.deleteMany({ where });
  await db.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
  await db.legalAcceptance.deleteMany({ where: { userId: { in: userIds } } });
  await db.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await cleanup();
});

async function mkLoginUser(opts: { mustChangePasscode?: boolean; termsAccepted?: boolean } = {}) {
  const user = await db.user.create({
    data: {
      id: randomUUID(),
      email: `sign-in-look-${randomUUID()}@example.test`,
      phone: null,
      firstName: 'Lena',
      surname: 'Look',
      passcodeHash: await bcrypt.hash(PASSCODE, 4),
      dateOfBirth: new Date('1990-01-01'),
      phoneVerifiedAt: new Date(),
      mustChangePasscode: opts.mustChangePasscode ?? false,
    },
  });
  userIds.push(user.id);
  if (opts.termsAccepted ?? true) {
    await db.legalAcceptance.create({ data: { id: randomUUID(), userId: user.id, documentSlug: 'terms-and-conditions', version: 'unpublished' } });
  }
  return user;
}

/** The new look's frame, and nothing of the old one. */
async function expectNewLook(page: Page) {
  const card = page.getByTestId('sign-in-card');
  await expect(card).toBeVisible();
  await expect(page.locator('.ultm8-auth-page, .ultm8-auth-card, .ultm8-auth-rail, .ultm8-card')).toHaveCount(0);
  await expect(page.locator('select')).toHaveCount(0);
  // The brand mark as the side menu shows it: a rounded tile, then the name.
  await expect(page.locator('.u8si-brand__mark')).toHaveText('U8');
  await expect(page.locator('.u8si-brand__name')).toHaveText('ULTM8');
  const look = await card.evaluate((el) => {
    const css = getComputedStyle(el);
    const button = el.querySelector('.ultm8-btn--primary');
    return {
      radius: parseFloat(css.borderTopLeftRadius),
      background: css.backgroundColor,
      page: getComputedStyle(el.closest('.u8si-page')!).backgroundColor,
      buttonRadius: button ? parseFloat(getComputedStyle(button).borderTopLeftRadius) : null,
    };
  });
  expect(look.radius).toBe(16);
  // A white card on the grey page, never the same colour as it.
  expect(look.background).not.toBe(look.page);
  if (look.buttonRadius !== null) expect(look.buttonRadius).toBeGreaterThanOrEqual(20);
  return look;
}

async function expectLight(page: Page) {
  const look = await expectNewLook(page);
  expect(look.background).toBe('rgb(255, 255, 255)');
  expect(look.page).toBe('rgb(241, 242, 243)');
}

async function expectDark(page: Page) {
  await page.emulateMedia({ colorScheme: 'dark' });
  const look = await expectNewLook(page);
  expect(look.background).not.toBe('rgb(255, 255, 255)');
  expect(look.page).not.toBe('rgb(241, 242, 243)');
  await page.emulateMedia({ colorScheme: 'light' });
}

/** Nothing scrolls the page sideways at phone width, and the card fits. */
async function expectPhoneFit(page: Page) {
  const before = page.viewportSize()!;
  await page.setViewportSize({ width: 360, height: 740 });
  const fit = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="sign-in-card"]')!.getBoundingClientRect();
    return { scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth, left: card.left, right: card.right };
  });
  expect(fit.scroll).toBeLessThanOrEqual(fit.width);
  expect(fit.left).toBeGreaterThanOrEqual(16);
  expect(fit.right).toBeLessThanOrEqual(360 - 16);
  await page.setViewportSize(before);
}

async function expectAllLooks(page: Page) {
  await expectLight(page);
  await expectDark(page);
  await expectPhoneFit(page);
}

/** Answers one Twilio-backed API call and keeps what the page sent. */
async function answer(page: Page, path: string, status = 201) {
  const sent: unknown[] = [];
  await page.route(`**/v1/auth/${path}`, async (route) => {
    const request: Request = route.request();
    if (request.method() !== 'POST') return route.continue();
    sent.push(request.postDataJSON());
    await route.fulfill({ status, contentType: 'application/json', body: '{}' });
  });
  return sent;
}

async function logIn(page: Page, email: string, passcode = PASSCODE) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Passcode', { exact: true }).fill(passcode);
  await page.getByRole('button', { name: 'Log in' }).click();
}

test('Log in: the new look, the same fields, and it still signs in', async ({ page }) => {
  const user = await mkLoginUser();
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByText('Every belt, every booking, one place.')).toBeVisible();
  await expectAllLooks(page);

  // What password managers rely on stays as it was.
  const email = page.getByLabel('Email');
  await expect(email).toHaveAttribute('type', 'email');
  await expect(email).toHaveAttribute('autocomplete', 'email');
  const passcode = page.getByLabel('Passcode', { exact: true });
  await expect(passcode).toHaveAttribute('type', 'password');
  await expect(passcode).toHaveAttribute('autocomplete', 'current-password');
  await expect(passcode).toHaveAttribute('inputmode', 'numeric');
  await expect(passcode).toHaveAttribute('pattern', '\\d{6}');
  await expect(passcode).toHaveAttribute('maxlength', '6');
  await expect(page.getByRole('link', { name: 'Forgot your passcode?' })).toHaveAttribute('href', '/forgot-passcode');
  await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register');

  // A wrong passcode still says so.
  await logIn(page, user.email, '999999');
  await expect(page.getByRole('alert')).toBeVisible();

  await logIn(page, user.email);
  // The success panel moves on by itself after a moment, so it is checked
  // quickly: the new frame, a mint circle and the round ✕.
  await expect(page.getByText('You are successfully logged in to your account.')).toBeVisible();
  await expectNewLook(page);
  const check = await page.locator('.ultm8-success-panel__check').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(check).toBe('rgb(159, 211, 178)');
  await expect(page.getByRole('button', { name: 'Dismiss' })).toHaveCSS('border-radius', '50%');
  // No School yet, so home is Create your School.
  await expect(page.getByRole('heading', { name: 'Create your School' })).toBeVisible();
  expect(await db.refreshToken.count({ where: { userId: user.id } })).toBeGreaterThan(0);
});

test('Create account: pills and the new drop-down, and it still sends the same sign-up', async ({ page }) => {
  const sent = await answer(page, 'register');
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'Create your School account' })).toBeVisible();
  await page.getByText('Optional details').click();
  await expectAllLooks(page);

  await page.getByLabel('Email').fill('new.owner@example.test');
  await page.getByLabel('Phone', { exact: true }).fill('+12015550123');
  await page.getByLabel('First name').fill('Nora');
  await page.getByLabel('Surname').fill('Owner');
  await page.getByLabel('Passcode', { exact: true }).fill(PASSCODE);
  await page.getByLabel('Confirm passcode').fill(PASSCODE);
  for (const label of ['Passcode', 'Confirm passcode']) {
    const field = page.getByLabel(label, { exact: true });
    await expect(field).toHaveAttribute('type', 'password');
    await expect(field).toHaveAttribute('inputmode', 'numeric');
    await expect(field).toHaveAttribute('pattern', '\\d{6}');
  }
  await page.getByLabel('Date of birth').fill('1990-05-04');
  await expect(page.getByLabel('Date of birth')).toHaveAttribute('type', 'date');

  // Gender: three short choices, so pills (Female, Male or not given).
  const gender = page.getByRole('group', { name: 'Gender' });
  await expect(gender.getByRole('button')).toHaveText(['Not set', 'Female', 'Male']);
  await expect(gender.getByRole('button', { name: 'Not set' })).toHaveAttribute('aria-pressed', 'true');
  await gender.getByRole('button', { name: 'Female' }).click();
  await expect(gender.getByRole('button', { name: 'Female' })).toHaveAttribute('aria-pressed', 'true');
  // Language: the new look's own drop-down.
  const language = page.getByRole('combobox', { name: 'Language', exact: true });
  await expect(language.locator('[data-shown="true"]')).toHaveText('Not set');
  await language.click();
  const options = page.getByRole('listbox', { name: 'Language', exact: true }).getByRole('option');
  expect(await options.count()).toBeGreaterThan(1);
  const second = options.nth(1);
  const languageLabel = (await second.textContent())!.trim();
  await second.click();
  await expect(language.locator('[data-shown="true"]')).toHaveText(languageLabel);

  await page.getByRole('checkbox', { name: /I agree to the Terms of Service/ }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Thanks for joining — next, verify your phone number.')).toBeVisible();
  await expectNewLook(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    email: 'new.owner@example.test',
    phone: '+12015550123',
    firstName: 'Nora',
    surname: 'Owner',
    passcode: PASSCODE,
    passcodeConfirm: PASSCODE,
    dateOfBirth: '1990-05-04',
    gender: 'FEMALE',
    acceptTerms: true,
  });
  expect(typeof (sent[0] as { language?: unknown }).language).toBe('string');

  // Next is Verify phone, with the number carried over.
  await expect(page.getByRole('heading', { name: 'Verify your phone' })).toBeVisible();
  await expect(page.getByLabel('Phone', { exact: true })).toHaveValue(/201/);
});

test('Verify phone: the code boxes keep one-time-code autofill, and verifying still leads to Log in', async ({ page }) => {
  const resent = await answer(page, 'otp/send');
  const verified = await answer(page, 'otp/verify');
  await page.goto('/verify-otp');
  await expect(page.getByRole('heading', { name: 'Verify your phone' })).toBeVisible();
  await expectAllLooks(page);

  const boxes = page.locator('.ultm8-segmented-code__box');
  await expect(boxes).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    await expect(boxes.nth(i)).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(boxes.nth(i)).toHaveAttribute('inputmode', 'numeric');
  }
  // A code box is a soft field: no border, rounded.
  const box = await boxes.first().evaluate((el) => ({ border: getComputedStyle(el).borderTopWidth, radius: getComputedStyle(el).borderTopLeftRadius }));
  expect(box).toEqual({ border: '0px', radius: '12px' });

  await page.getByLabel('Phone', { exact: true }).fill('+12015550123');
  await page.getByRole('button', { name: 'Resend code' }).click();
  await expect(page.getByText('Code resent.')).toBeVisible();
  expect(resent).toEqual([{ phone: '+12015550123' }]);

  await boxes.first().click();
  await page.keyboard.type('482913');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('Phone verified. You can log in now.')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  expect(verified).toEqual([{ phone: '+12015550123', code: '482913' }]);
  await expectNewLook(page);
});

test('Forgot and Reset passcode: the new look, and the reset still goes through to Log in', async ({ page }) => {
  const forgot = await answer(page, 'forgot-password');
  const reset = await answer(page, 'reset-password');
  await page.goto('/forgot-passcode');
  await expect(page.getByRole('heading', { name: 'Reset your passcode' })).toBeVisible();
  await expectAllLooks(page);
  await expect(page.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  await page.getByLabel('Phone', { exact: true }).fill('+12015550123');
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByRole('heading', { name: 'Set a new passcode' })).toBeVisible();
  expect(forgot).toEqual([{ phone: '+12015550123' }]);
  await expect(page).toHaveURL(/\/reset-passcode$/);
  await expectAllLooks(page);
  const boxes = page.locator('.ultm8-segmented-code__box');
  await expect(boxes).toHaveCount(6);
  await expect(boxes.first()).toHaveAttribute('autocomplete', 'one-time-code');
  await boxes.first().click();
  await page.keyboard.type('135790');
  await page.getByLabel('New passcode', { exact: true }).fill(NEW_PASSCODE);
  await page.getByLabel('Confirm new passcode').fill('111111');
  await page.getByRole('button', { name: 'Set new passcode' }).click();
  // The page's own check, as before.
  await expect(page.getByText('New passcode and confirmation must match.')).toBeVisible();
  expect(reset).toHaveLength(0);
  await page.getByLabel('Confirm new passcode').fill(NEW_PASSCODE);
  await page.getByRole('button', { name: 'Set new passcode' }).click();
  await expect(page.getByText('Log in with your new 6-digit passcode.')).toBeVisible();
  expect(reset).toEqual([{ phone: '+12015550123', code: '135790', newPasscode: NEW_PASSCODE }]);
  await expectNewLook(page);
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('First-login passcode: the new look, and choosing a passcode still signs in', async ({ page }) => {
  const user = await mkLoginUser({ mustChangePasscode: true, termsAccepted: true });
  await page.goto('/login');
  await logIn(page, user.email);
  await expect(page.getByRole('heading', { name: 'Choose your passcode' })).toBeVisible();
  await expectAllLooks(page);
  for (const label of ['New passcode', 'Confirm new passcode']) {
    const field = page.getByLabel(label, { exact: true });
    await expect(field).toHaveAttribute('type', 'password');
    await expect(field).toHaveAttribute('inputmode', 'numeric');
    await expect(field).toHaveAttribute('maxlength', '6');
  }
  await page.getByLabel('New passcode', { exact: true }).fill(NEW_PASSCODE);
  await page.getByLabel('Confirm new passcode').fill(NEW_PASSCODE);
  await page.getByRole('button', { name: 'Set passcode and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Create your School' })).toBeVisible();
  const saved = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(saved.mustChangePasscode).toBe(false);
  expect(await bcrypt.compare(NEW_PASSCODE, saved.passcodeHash)).toBe(true);
});

test('Accept the Terms: the new look, and ticking still records the acceptance', async ({ page }) => {
  const user = await mkLoginUser({ termsAccepted: false });
  await page.goto('/login');
  await logIn(page, user.email);
  await expect(page.getByRole('heading', { name: 'Before you continue' })).toBeVisible();
  await expectAllLooks(page);
  const tick = page.getByRole('checkbox', { name: /I agree to the Terms of Service/ });
  await expect(tick).toHaveAttribute('required', '');
  await expect(page.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/legal/terms-and-conditions');
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  await tick.check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Create your School' })).toBeVisible();
  const rows = await db.legalAcceptance.findMany({ where: { userId: user.id }, orderBy: { documentSlug: 'asc' } });
  expect(rows.map((r) => [r.documentSlug, r.atFirstSignIn])).toEqual([
    ['privacy-statement', true],
    ['terms-and-conditions', true],
  ]);
});

test('Coach invite: the new look signed out and in, and accepting still makes a coach', async ({ page }) => {
  const user = await mkLoginUser();
  const token = await addCoachInvite(s, user.email);
  await page.goto(`/coach-invite/${token}`);
  await expect(page.getByRole('heading', { name: "You're invited to coach" })).toBeVisible();
  await expectAllLooks(page);
  // Log in and Create an account share their row equally (DESIGN.md → "Button pairs").
  const logInButton = page.getByRole('button', { name: 'Log in' });
  const create = page.getByRole('button', { name: 'Create an account' });
  const [a, b] = [await logInButton.boundingBox(), await create.boundingBox()];
  expect(Math.round(a!.width)).toBe(Math.round(b!.width));
  expect(Math.round(a!.y)).toBe(Math.round(b!.y));

  await logInButton.click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await logIn(page, user.email);
  // Log in brings them back to the invite.
  await expect(page.getByRole('heading', { name: "You're invited to coach" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept invite' })).toBeVisible();
  await expectAllLooks(page);
  await page.getByRole('button', { name: 'Accept invite' }).click();
  await expect(page.getByText(/You're now a coach at Portal E2E/)).toBeVisible();
  await expectNewLook(page);
  expect(await db.roleGrant.count({ where: { userId: user.id, schoolId: s.schoolId, role: 'INSTRUCTOR', revokedAt: null } })).toBe(1);
});

test('Guest waiver: the new look, and a guest still signs by the link', async ({ page }) => {
  const secret = process.env.JWT_ACCESS_SECRET!;
  const waiver = await db.waiver.create({ data: { id: randomUUID(), schoolId: s.schoolId, title: 'Liability', body: 'Training has risks.' } });
  const cls = await db.class.create({
    data: { id: randomUUID(), schoolId: s.schoolId, title: 'Guest Night', activities: ['BJJ'], membershipInclusion: true, termsWaiverRequired: true, startDate: new Date(Date.now() + 86_400_000), endDate: new Date(Date.now() + 90_000_000) },
  });
  const sub = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: `Unlimited ${randomUUID().slice(0, 4)}`, price: 5000 } });
  const own = await db.membership.create({ data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: sub.id, schoolId: s.schoolId, frequency: 'RECURRING' } });
  const fp = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'FRIEND_PASS', title: `Friend ${randomUUID().slice(0, 4)}`, price: 0, classesIncluded: 1 } });
  const pass = await db.membership.create({ data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: fp.id, schoolId: s.schoolId, frequency: 'ONE_TIME', classesRemaining: 0 } });
  const booking = await db.booking.create({ data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: own.id } });
  const attendeeId = randomUUID();
  const token = createHmac('sha256', secret).update(`guest-waiver-link:v1:${attendeeId}`).digest('base64url');
  await db.bookingAttendee.create({
    data: { id: attendeeId, bookingId: booking.id, schoolId: s.schoolId, membershipId: pass.id, guestTokenHash: createHash('sha256').update(token).digest('hex') },
  });

  await page.goto(`/guest-waiver/${token}`);
  await expect(page.getByRole('heading', { name: 'Sign the waiver' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Liability' }).getByText('Training has risks.')).toBeVisible();
  await expectAllLooks(page);
  await expect(page.getByLabel("Guest's full name")).toHaveAttribute('autocomplete', 'name');
  await expect(page.getByLabel("Guest's date of birth")).toHaveAttribute('type', 'date');

  const signButton = page.getByRole('button', { name: 'Sign', exact: true });
  await expect(signButton).toBeDisabled();
  await page.getByLabel("Guest's full name").fill('Ada Guest');
  await page.getByLabel("Guest's date of birth").fill('1991-02-03');
  await page.getByLabel('Type your full name to sign').fill('Ada Guest');
  await page.getByLabel('I have read these waivers and I agree to them.').check();
  await signButton.click();
  await expect(page.getByText('Thank you, Ada Guest. The waivers are signed. See you at')).toBeVisible();
  await expectNewLook(page);
  const row = await db.guestWaiverSignature.findFirstOrThrow({ where: { schoolId: s.schoolId, waiverId: waiver.id } });
  expect(row).toMatchObject({ guestFullName: 'Ada Guest', signerFullName: 'Ada Guest', signedByGuardian: false, signedWaiverBody: 'Training has risks.' });
});

test('Create your School (/onboarding): the shared sign-in card takes the same new-look frame', async ({ page }) => {
  // Its fields are rebuilt in their own PR; this checks the frame around them.
  const user = await mkLoginUser();
  await page.goto('/login');
  await logIn(page, user.email);
  await expect(page.getByRole('heading', { name: 'Create your School' })).toBeVisible();
  const frame = async () =>
    page.locator('.ultm8-auth-card > .ultm8-card').evaluate((el) => ({
      radius: getComputedStyle(el).borderTopLeftRadius,
      background: getComputedStyle(el).backgroundColor,
      page: getComputedStyle(el.closest('.ultm8-auth-page')!).backgroundColor,
      title: getComputedStyle(el.querySelector('.ultm8-auth-card__title')!).fontWeight,
    }));
  expect(await frame()).toEqual({ radius: '16px', background: 'rgb(255, 255, 255)', page: 'rgb(241, 242, 243)', title: '300' });
  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await frame();
  expect(dark.background).not.toBe('rgb(255, 255, 255)');
  expect(dark.background).not.toBe(dark.page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 360, height: 740 });
  const fit = await page.evaluate(() => {
    const card = document.querySelector('.ultm8-auth-card > .ultm8-card')!.getBoundingClientRect();
    return { scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth, left: card.left, right: card.right };
  });
  expect(fit.scroll).toBeLessThanOrEqual(fit.width);
  expect(fit.left).toBeGreaterThanOrEqual(16);
  expect(fit.right).toBeLessThanOrEqual(360 - 16);
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
});
