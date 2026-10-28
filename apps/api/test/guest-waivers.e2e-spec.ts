/**
 * Waivers Q9 — guests on a booking sign the School's waivers by a shared link.
 * Booking a guest with a Friend Pass, the booker's and staff's view of each
 * guest, the public signing page, the token-holder isolation, the Owner's
 * guest signature list, and the retention purge.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaAppService } from '../src/common/prisma/prisma-app.service';
import { EntityOffboardingPurgeProcessor } from '../src/jobs/entity-offboarding-purge.processor';
import { guestWaiverToken, hashGuestWaiverToken } from '../src/waivers/guest-waiver-token';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[guest-waivers.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PORTAL = 'https://portal.example.test';

describeIfDb('Guest waivers (Waivers Q9)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const school = { id: randomUUID() };
  type U = { id: string; email: string; token: string };
  let owner: U;
  let coach: U;
  let booker: U;
  let other: U;
  let subscriptionPlanId: string;
  let friendPassPlanId: string;
  const waiverIds: string[] = [];
  const previousPortal = process.env.PORTAL_BASE_URL;

  const http = () => request(app.getHttpServer());
  const auth = (u: U) => ({ Authorization: `Bearer ${u.token}` });
  const at = (ms: number) => new Date(Date.now() + ms);
  const mkClass = (data: Record<string, unknown> = {}) =>
    superuser.class.create({
      data: { membershipInclusion: true, termsWaiverRequired: true, id: randomUUID(), schoolId: school.id, title: 'Open Mat', startDate: at(2 * HOUR), endDate: at(3 * HOUR), ...data },
    });
  const mkPass = (studentId: string, data: Record<string, unknown> = {}) =>
    superuser.membership.create({
      data: { id: randomUUID(), studentId, schoolId: school.id, membershipPlanId: friendPassPlanId, frequency: 'ONE_TIME', classesRemaining: 1, ...data },
    });
  const tokenOf = (link: string) => link.slice(`${PORTAL}/guest-waiver/`.length);

  async function mkUser(label: string, role: 'SCHOOL_OWNER_MANAGER' | 'INSTRUCTOR' | 'STUDENT'): Promise<U> {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `guest-waivers-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Guest',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, schoolId: school.id } });
    const token = jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId: school.id, branchId: null }] });
    return { id: user.id, email: user.email, token };
  }

  /** Books `classId` for the booker with one guest; returns the booking and the guest's link. */
  async function bookWithGuest(classId: string, who: U = booker) {
    const pass = await mkPass(who.id);
    const booked = await http().post(`/v1/classes/${classId}/book`).set(auth(who)).send({ attendeeMembershipIds: [pass.id] });
    expect(booked.status).toBe(201);
    const guests = await http().get(`/v1/bookings/${booked.body.id}/guests`).set(auth(who));
    expect(guests.status).toBe(200);
    return { bookingId: booked.body.id as string, attendeeId: guests.body.guests[0].attendeeId as string, link: guests.body.guests[0].link as string };
  }

  const page = (token: string) => http().get(`/v1/guest-waiver-links/${token}`);
  const signBody = (waivers: Array<{ id: string; version: number }>, extra: Record<string, unknown> = {}) => ({
    guestFullName: 'Gina Guest',
    guestDateOfBirth: '1992-05-04',
    signerFullName: 'Gina Guest',
    signatureText: 'Gina Guest',
    waivers: waivers.map((w) => ({ waiverId: w.id, version: w.version })),
    ...extra,
  });
  const sign = (token: string, body: Record<string, unknown>) => http().post(`/v1/guest-waiver-links/${token}/sign`).send(body);

  beforeAll(async () => {
    process.env.PORTAL_BASE_URL = PORTAL;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.create({ data: { id: school.id, name: 'Guest Dojo', timezone: 'UTC' } });
    owner = await mkUser('owner', 'SCHOOL_OWNER_MANAGER');
    coach = await mkUser('coach', 'INSTRUCTOR');
    booker = await mkUser('booker', 'STUDENT');
    other = await mkUser('other', 'STUDENT');
    subscriptionPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } })).id;
    friendPassPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'FRIEND_PASS', title: 'Friend Pass', price: 0, classesIncluded: 1 } })).id;
    for (const s of [booker, other]) {
      await superuser.membership.create({ data: { id: randomUUID(), studentId: s.id, schoolId: school.id, membershipPlanId: subscriptionPlanId, frequency: 'RECURRING' } });
    }
    for (const title of ['Liability', 'Photos']) {
      const w = await superuser.waiver.create({ data: { id: randomUUID(), schoolId: school.id, title, body: `${title} terms` } });
      waiverIds.push(w.id);
      for (const s of [booker, other]) {
        await superuser.waiverSignature.create({
          data: { id: randomUUID(), waiverId: w.id, studentId: s.id, schoolId: school.id, signerFullName: 'Me', signatureText: 'Me', status: 'SIGNED' },
        });
      }
    }
  });

  afterAll(async () => {
    if (previousPortal === undefined) delete process.env.PORTAL_BASE_URL;
    else process.env.PORTAL_BASE_URL = previousPortal;
    const userIds = (await superuser.user.findMany({ where: { email: { contains: 'guest-waivers-' } }, select: { id: true } })).map((u) => u.id);
    await superuser.guestWaiverSignature.deleteMany({ where: { schoolId: school.id } });
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.waiverSignature.deleteMany({ where: { schoolId: school.id } });
    await superuser.waiver.deleteMany({ where: { schoolId: school.id } });
    await superuser.bookingAttendee.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it("lists only the caller's own usable Friend Passes at the School", async () => {
    const cls = await mkClass();
    const open = await mkPass(booker.id);
    const scoped = await mkPass(booker.id, { scopedClassId: cls.id });
    await mkPass(booker.id, { classesRemaining: 0 });
    await mkPass(booker.id, { expiryDate: at(-DAY) });
    await mkPass(other.id);
    const res = await http().get(`/v1/schools/${school.id}/friend-passes/me`).set(auth(booker));
    expect(res.status).toBe(200);
    const ids = res.body.items.map((p: { membershipId: string }) => p.membershipId);
    expect(ids).toEqual(expect.arrayContaining([open.id, scoped.id]));
    expect(ids).toHaveLength(2);
    expect(res.body.items.find((p: { membershipId: string }) => p.membershipId === scoped.id).scopedClassId).toBe(cls.id);
    await superuser.membership.deleteMany({ where: { id: { in: [open.id, scoped.id] } } });
  });

  it('a booked guest gets a link; the booker and the Owner see it, an Instructor sees only the status, another student nothing', async () => {
    const cls = await mkClass();
    const { bookingId, attendeeId, link } = await bookWithGuest(cls.id);
    expect(link).toBe(`${PORTAL}/guest-waiver/${guestWaiverToken(attendeeId)}`);
    const stored = await superuser.bookingAttendee.findUniqueOrThrow({ where: { id: attendeeId } });
    expect(stored.guestTokenHash).toBe(hashGuestWaiverToken(tokenOf(link)));

    const mine = await http().get(`/v1/bookings/${bookingId}/guests`).set(auth(booker));
    expect(mine.body).toEqual({ bookingId, waiverRequired: true, guests: [{ attendeeId, link, waiverStatus: 'UNSIGNED', guestFullName: null, checkedInAt: null }] });
    expect((await http().get(`/v1/bookings/${bookingId}/guests`).set(auth(owner))).body.guests[0].link).toBe(link);
    const coachView = await http().get(`/v1/bookings/${bookingId}/guests`).set(auth(coach));
    expect(coachView.status).toBe(200);
    expect(coachView.body.guests[0]).toEqual({ attendeeId, link: null, waiverStatus: 'UNSIGNED', guestFullName: null, checkedInAt: null });
    expect((await http().get(`/v1/bookings/${bookingId}/guests`).set(auth(other))).status).toBe(404);

    const classView = await http().get(`/v1/classes/${cls.id}/guest-waivers`).set(auth(coach));
    expect(classView.status).toBe(200);
    expect(classView.body.waiverRequired).toBe(true);
    expect(classView.body.bookings).toHaveLength(1);
    expect((await http().get(`/v1/classes/${cls.id}/guest-waivers`).set(auth(other))).status).toBe(403);
  });

  it('the guest reads and signs every current waiver once; the Owner sees the record', async () => {
    const cls = await mkClass({ title: 'Guest Night' });
    const { bookingId, link } = await bookWithGuest(cls.id);
    const token = tokenOf(link);

    expect((await page('not-a-token')).status).toBe(404);
    expect((await page('A'.repeat(43))).status).toBe(404);
    const first = await page(token);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ schoolName: 'Guest Dojo', classTitle: 'Guest Night', status: 'OPEN', guestFullName: null });
    expect(first.body.waivers.map((w: { title: string; signed: boolean }) => [w.title, w.signed])).toEqual([
      ['Liability', false],
      ['Photos', false],
    ]);
    const waivers = first.body.waivers as Array<{ id: string; version: number }>;

    expect((await sign(token, signBody(waivers.slice(0, 1)))).status).toBe(409);
    expect((await sign(token, signBody(waivers.map((w) => ({ ...w, version: w.version + 1 }))))).status).toBe(409);
    expect((await sign(token, signBody(waivers, { guestDateOfBirth: '2999-01-01' }))).status).toBe(400);
    expect((await sign(token, signBody(waivers, { guestDateOfBirth: '1990-02-30' }))).status).toBe(400);

    const ok = await sign(token, signBody(waivers));
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ signed: 2 });
    expect((await sign(token, signBody(waivers))).status).toBe(409);

    const after = await page(token);
    expect(after.body.guestFullName).toBe('Gina Guest');
    expect(after.body.waivers.every((w: { signed: boolean }) => w.signed)).toBe(true);
    const guests = await http().get(`/v1/bookings/${bookingId}/guests`).set(auth(booker));
    expect(guests.body.guests[0]).toMatchObject({ waiverStatus: 'SIGNED', guestFullName: 'Gina Guest' });

    const list = await http().get(`/v1/schools/${school.id}/waivers/${waiverIds[0]}/guest-signatures`).set(auth(owner));
    expect(list.status).toBe(200);
    const row = list.body.items.find((s: { classTitle: string }) => s.classTitle === 'Guest Night');
    expect(row).toMatchObject({ guestFullName: 'Gina Guest', guestDateOfBirth: '1992-05-04', signedByGuardian: false, bookedByName: 'booker Guest' });
    const detail = await http().get(`/v1/schools/${school.id}/waivers/${waiverIds[0]}/guest-signatures/${row.id}`).set(auth(owner));
    expect(detail.body).toMatchObject({ signedWaiverTitle: 'Liability', signedWaiverBody: 'Liability terms' });
    expect((await http().get(`/v1/schools/${school.id}/waivers/${waiverIds[0]}/guest-signatures`).set(auth(booker))).status).toBe(403);
    expect((await http().get(`/v1/schools/${school.id}/waivers/${waiverIds[0]}/guest-signatures`).set(auth(coach))).status).toBe(403);

    // A new waiver after signing: the guest is asked for that one only.
    const added = await superuser.waiver.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Late', body: 'Late terms' } });
    try {
      expect((await http().get(`/v1/bookings/${bookingId}/guests`).set(auth(booker))).body.guests[0].waiverStatus).toBe('UNSIGNED');
      const again = await page(token);
      const unsigned = again.body.waivers.filter((w: { signed: boolean }) => !w.signed);
      expect(unsigned.map((w: { id: string }) => w.id)).toEqual([added.id]);
      expect((await sign(token, signBody(unsigned))).body).toEqual({ signed: 1 });
    } finally {
      await superuser.guestWaiverSignature.deleteMany({ where: { waiverId: added.id } });
      await superuser.waiver.delete({ where: { id: added.id } });
    }
  });

  it('a parent or guardian signs for a guest under 18', async () => {
    const cls = await mkClass();
    const { link } = await bookWithGuest(cls.id);
    const token = tokenOf(link);
    const waivers = (await page(token)).body.waivers;
    const childDob = new Date();
    childDob.setUTCFullYear(childDob.getUTCFullYear() - 10);
    const dob = childDob.toISOString().slice(0, 10);
    expect((await sign(token, signBody(waivers, { guestFullName: 'Kid Guest', guestDateOfBirth: dob, signerFullName: 'kid guest' }))).status).toBe(400);
    expect((await sign(token, signBody(waivers, { guestFullName: 'Kid Guest', guestDateOfBirth: dob, signerFullName: 'Pat Parent' }))).status).toBe(200);
    const rows = await superuser.guestWaiverSignature.findMany({ where: { guestFullName: 'Kid Guest' } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.signedByGuardian && r.signerFullName === 'Pat Parent')).toBe(true);
  });

  it('the link closes when the booking is cancelled', async () => {
    const cls = await mkClass({ startDate: at(5 * DAY), endDate: at(5 * DAY + HOUR) });
    const { bookingId, link } = await bookWithGuest(cls.id);
    const token = tokenOf(link);
    const waivers = (await page(token)).body.waivers;
    expect((await http().patch(`/v1/bookings/${bookingId}/cancel`).set(auth(booker)).send({})).status).toBe(200);
    const closed = await page(token);
    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.waivers).toEqual([]);
    expect((await sign(token, signBody(waivers))).status).toBe(410);
  });

  it("a link's token only reaches its own seat", async () => {
    const cls = await mkClass();
    const a = await bookWithGuest(cls.id);
    const b = await bookWithGuest(cls.id, other);
    // Seat B's signature written directly: the signing route's per-IP limit
    // (10 a minute) is already spent by the tests above.
    await superuser.guestWaiverSignature.create({
      data: {
        schoolId: school.id,
        bookingAttendeeId: b.attendeeId,
        waiverId: waiverIds[0],
        classTitle: 'Seat B class',
        classStartsAt: new Date(),
        guestFullName: 'Seat B',
        guestDateOfBirth: new Date('1990-01-01'),
        signerFullName: 'Seat B',
        signatureText: 'Seat B',
        signedByGuardian: false,
        signedWaiverTitle: 'x',
        signedWaiverBody: 'x',
        signedWaiverSha256: 'x',
        signedWaiverVersion: 1,
      },
    });

    const prismaApp = app.get(PrismaAppService);
    const hashA = hashGuestWaiverToken(tokenOf(a.link));
    const seen = await prismaApp.withGuestWaiverToken(hashA, (tx) => tx.guestWaiverSignature.findMany({ where: { bookingAttendeeId: b.attendeeId } }));
    expect(seen).toEqual([]);
    const ownSeat = await prismaApp.withGuestWaiverToken(hashGuestWaiverToken(tokenOf(b.link)), (tx) => tx.guestWaiverSignature.count({ where: { bookingAttendeeId: b.attendeeId } }));
    expect(ownSeat).toBe(1);
    await expect(
      prismaApp.withGuestWaiverToken(hashA, (tx) =>
        tx.guestWaiverSignature.create({
          data: {
            schoolId: school.id,
            bookingAttendeeId: b.attendeeId,
            waiverId: waiverIds[0],
            classTitle: 'x',
            classStartsAt: new Date(),
            guestFullName: 'Intruder',
            guestDateOfBirth: new Date('1990-01-01'),
            signerFullName: 'Intruder',
            signatureText: 'Intruder',
            signedByGuardian: false,
            signedWaiverTitle: 'x',
            signedWaiverBody: 'x',
            signedWaiverSha256: 'x',
            signedWaiverVersion: 1,
          },
        }),
      ),
    ).rejects.toThrow();
    // No token: a plain app connection sees no guest signatures at all.
    expect(await prismaApp.$transaction((tx) => tx.guestWaiverSignature.count())).toBe(0);
  });

  it('the purge keeps a guest signature 7 years after the class, and a minor until 24', async () => {
    const base = {
      schoolId: school.id,
      waiverId: waiverIds[0],
      classTitle: 'Old class',
      signerFullName: 'S',
      signatureText: 'S',
      signedWaiverTitle: 't',
      signedWaiverBody: 'b',
      signedWaiverSha256: 'h',
      signedWaiverVersion: 1,
    };
    const yearsAgo = (n: number) => {
      const d = new Date();
      d.setUTCFullYear(d.getUTCFullYear() - n);
      return d;
    };
    const adultOld = await superuser.guestWaiverSignature.create({
      data: { ...base, classStartsAt: yearsAgo(8), guestFullName: 'Adult old', guestDateOfBirth: yearsAgo(40), signedByGuardian: false },
    });
    const adultRecent = await superuser.guestWaiverSignature.create({
      data: { ...base, classStartsAt: yearsAgo(6), guestFullName: 'Adult recent', guestDateOfBirth: yearsAgo(40), signedByGuardian: false },
    });
    const minorStill = await superuser.guestWaiverSignature.create({
      data: { ...base, classStartsAt: yearsAgo(8), guestFullName: 'Minor still', guestDateOfBirth: yearsAgo(20), signedByGuardian: true },
    });
    const minorDone = await superuser.guestWaiverSignature.create({
      data: { ...base, classStartsAt: yearsAgo(10), guestFullName: 'Minor done', guestDateOfBirth: yearsAgo(25), signedByGuardian: true },
    });
    await app.get(EntityOffboardingPurgeProcessor).process({} as never);
    const left = (await superuser.guestWaiverSignature.findMany({ where: { id: { in: [adultOld.id, adultRecent.id, minorStill.id, minorDone.id] } } })).map((r) => r.id);
    expect(left.sort()).toEqual([adultRecent.id, minorStill.id].sort());
  });
});
