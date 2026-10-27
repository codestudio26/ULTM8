import { createHash, createHmac, randomUUID } from 'crypto';
import { expect, test } from '@playwright/test';
import { cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Guests on a booking sign the School's waivers by a link (Waivers Q9): the
 * public signing page, the class page's "hasn't signed" notes, and the
 * Waivers page's guest signatures. The booking with a guest is seeded
 * directly; the Student app is where a member books one.
 */
let s: GradingSchool;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(Date.now() + ms);

/** The API's guest link token (apps/api/src/waivers/guest-waiver-token.ts). */
function tokenFor(attendeeId: string) {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET is not set');
  return createHmac('sha256', secret).update(`guest-waiver-link:v1:${attendeeId}`).digest('base64url');
}

async function seedGuestBooking(title = 'Open mat') {
  const waiver = await db.waiver.create({ data: { id: randomUUID(), schoolId: s.schoolId, title: 'Liability', body: 'Training has risks.' } });
  const cls = await db.class.create({
    data: { id: randomUUID(), schoolId: s.schoolId, title, activities: ['BJJ'], membershipInclusion: true, termsWaiverRequired: true, startDate: at(DAY), endDate: at(DAY + HOUR) },
  });
  const sub = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'SUBSCRIPTION', title: `Unlimited ${randomUUID().slice(0, 4)}`, price: 5000 } });
  const own = await db.membership.create({ data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: sub.id, schoolId: s.schoolId, frequency: 'RECURRING' } });
  const fp = await db.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.schoolId, type: 'FRIEND_PASS', title: `Friend ${randomUUID().slice(0, 4)}`, price: 0, classesIncluded: 1 } });
  const pass = await db.membership.create({ data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: fp.id, schoolId: s.schoolId, frequency: 'ONE_TIME', classesRemaining: 0 } });
  const booking = await db.booking.create({ data: { id: randomUUID(), studentId: s.student.id, classId: cls.id, schoolId: s.schoolId, sourceMembershipId: own.id } });
  const attendeeId = randomUUID();
  const token = tokenFor(attendeeId);
  await db.bookingAttendee.create({
    data: { id: attendeeId, bookingId: booking.id, schoolId: s.schoolId, membershipId: pass.id, guestTokenHash: createHash('sha256').update(token).digest('hex') },
  });
  return { waiver, cls, booking, token };
}

test.beforeEach(async () => {
  s = await seedGradingSchool();
});

test.afterEach(async () => {
  const where = { schoolId: s.schoolId };
  await db.guestWaiverSignature.deleteMany({ where });
  await db.bookingAttendee.deleteMany({ where });
  await db.booking.deleteMany({ where });
  await db.membership.deleteMany({ where });
  await db.membershipPlan.deleteMany({ where });
  await db.class.deleteMany({ where });
  await db.waiverSignature.deleteMany({ where });
  await db.waiver.deleteMany({ where });
});

test.afterAll(async () => {
  await cleanup();
});

test('a guest signs by the link with no account; a child guest is signed for by a parent', async ({ page }) => {
  const { token } = await seedGuestBooking('Guest Night');
  await page.goto(`/guest-waiver/${token}`);
  await expect(page.getByRole('heading', { name: 'Sign the waiver' })).toBeVisible();
  await expect(page.getByText(/booked into Guest Night/)).toBeVisible();
  await expect(page.getByText('Training has risks.')).toBeVisible();

  const signButton = page.getByRole('button', { name: 'Sign', exact: true });
  await page.getByLabel("Guest's full name").fill('Kid Guest');
  const tenYearsAgo = new Date();
  tenYearsAgo.setUTCFullYear(tenYearsAgo.getUTCFullYear() - 10);
  await page.getByLabel("Guest's date of birth").fill(tenYearsAgo.toISOString().slice(0, 10));
  await expect(page.getByText('The guest is under 18, so a parent or guardian signs for them.')).toBeVisible();
  await page.getByLabel('Type your full name to sign').fill('Pat Parent');
  await page.getByLabel('I have read these waivers and I agree to them.').check();
  await expect(signButton).toBeDisabled();
  await page.getByLabel("Parent or guardian's full name").fill('Pat Parent');
  await signButton.click();
  await expect(page.getByText('Thank you, Kid Guest. The waivers are signed. See you at')).toBeVisible();

  const row = await db.guestWaiverSignature.findFirstOrThrow({ where: { schoolId: s.schoolId } });
  expect(row).toMatchObject({ guestFullName: 'Kid Guest', signerFullName: 'Pat Parent', signedByGuardian: true, signedWaiverBody: 'Training has risks.' });

  // Coming back to the link shows it's done.
  await page.reload();
  await expect(page.getByText(/The waivers are signed/)).toBeVisible();
});

test('a bad link says so', async ({ page }) => {
  await page.goto(`/guest-waiver/${'A'.repeat(43)}`);
  await expect(page.getByText('This waiver link is not valid. Ask the person who booked you for the link again.')).toBeVisible();
});

test("the class page flags a guest who hasn't signed, and the Waivers page lists guests who have", async ({ page }) => {
  const { waiver, cls, booking, token } = await seedGuestBooking('Flag class');
  await signIn(page, s.ownerToken);
  await page.goto(`/classes/${cls.id}`);
  await expect(page.getByText("Guests who haven't signed the waiver yet: 1.", { exact: false })).toBeVisible();
  await expect(page.getByText("Guest hasn't signed the waiver")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy signing link' })).toBeVisible();

  const attendee = await db.bookingAttendee.findFirstOrThrow({ where: { bookingId: booking.id } });
  await db.guestWaiverSignature.create({
    data: {
      schoolId: s.schoolId,
      bookingAttendeeId: attendee.id,
      bookingId: booking.id,
      bookedById: s.student.id,
      waiverId: waiver.id,
      classId: cls.id,
      classTitle: cls.title,
      classStartsAt: cls.startDate,
      guestFullName: 'Gina Guest',
      guestDateOfBirth: new Date('1992-05-04'),
      signerFullName: 'Gina Guest',
      signatureText: 'Gina Guest',
      signedByGuardian: false,
      signedWaiverTitle: 'Liability',
      signedWaiverBody: 'Training has risks.',
      signedWaiverSha256: 'x',
      signedWaiverVersion: 1,
    },
  });
  expect(token).toBeTruthy();
  await page.reload();
  await expect(page.getByText('Waiver signed: Gina Guest')).toBeVisible();
  await expect(page.getByText(/haven't signed the waiver yet/)).toHaveCount(0);

  await page.goto('/waivers');
  await page.getByRole('button', { name: /Liability/ }).first().click();
  const panel = page.getByRole('region', { name: 'Guest signatures' });
  await expect(panel.getByText('Gina Guest')).toBeVisible();
  await expect(panel.getByText(`Booked by ${s.student.name}`)).toBeVisible();
  await panel.getByRole('button', { name: 'View' }).click();
  await expect(panel.getByText('Training has risks.')).toBeVisible();
});
