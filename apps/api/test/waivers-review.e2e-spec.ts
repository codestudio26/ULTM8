/**
 * Waivers review fixes (26 Oct 2026): each test is the check that proved the
 * bug, now asserting the fixed behaviour.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { WaiverSignatureRequestsProcessor } from '../src/jobs/waiver-signature-requests.processor';
import { NOTIFICATION_FANOUT_QUEUE } from '../src/jobs/queue.constants';
import { getQueueToken } from '@nestjs/bullmq';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[waivers-review.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const HOUR = 3_600_000;

describeIfDb('Waivers review fixes', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const school = { id: randomUUID() };
  const emptySchool = { id: randomUUID() };
  type U = { id: string; email: string; token: string };
  let owner: U;
  let emptyOwner: U;
  const students: U[] = [];
  let fanoutAdds: Array<{ data: { body: string } }> = [];

  const http = () => request(app.getHttpServer());
  const auth = (u: U) => ({ Authorization: `Bearer ${u.token}` });

  async function mkUser(label: string, schoolId: string | null, role?: string, dateOfBirth: Date | null = new Date('1990-01-01')): Promise<U> {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `waivers-review-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Review',
        passcodeHash: 'x',
        dateOfBirth,
        phoneVerifiedAt: new Date(),
      },
    });
    if (role && schoolId) await superuser.roleGrant.create({ data: { id: randomUUID(), role: role as never, userId: user.id, schoolId } });
    const grants = role && schoolId ? [{ role, franchiseId: null, schoolId, branchId: null }] : [];
    return { id: user.id, email: user.email, token: jwt.sign({ sub: user.id, email: user.email, grants }) };
  }
  const mkWaiver = async (by: U, schoolId: string, title = 'Liability', body = 'Version one') =>
    (await http().post(`/v1/schools/${schoolId}/waivers`).set(auth(by)).send({ title, body })).body as { id: string; version: number };
  const sign = (waiverId: string, who: U, body: Record<string, unknown> = {}) =>
    http().post(`/v1/waivers/${waiverId}/sign`).set(auth(who)).send({ signerFullName: 'Ann Review', signatureText: 'Ann Review', ...body });
  const signatures = (waiverId: string) => http().get(`/v1/schools/${school.id}/waivers/${waiverId}/signatures?limit=100`).set(auth(owner));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.create({ data: { id: school.id, name: 'Review Dojo', timezone: 'UTC' } });
    await superuser.school.create({ data: { id: emptySchool.id, name: 'Empty Dojo', timezone: 'UTC' } });
    owner = await mkUser('owner', school.id, 'SCHOOL_OWNER_MANAGER');
    emptyOwner = await mkUser('empty-owner', emptySchool.id, 'SCHOOL_OWNER_MANAGER');
    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
    for (let i = 0; i < 6; i++) {
      const s = await mkUser(`student${i}`, school.id, 'STUDENT');
      students.push(s);
      await superuser.membership.create({ data: { id: randomUUID(), studentId: s.id, schoolId: school.id, membershipPlanId: plan.id, frequency: 'RECURRING' } });
    }
  });

  afterAll(async () => {
    const userIds = (await superuser.user.findMany({ where: { email: { contains: 'waivers-review-' } }, select: { id: true } })).map((u) => u.id);
    const schoolIds = [school.id, emptySchool.id];
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.waitlistEntry.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.booking.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membership.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.class.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.waiverSignature.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.waiver.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('W1: after a student leaves, the Signatures panel still loads; their unsigned entry drops out, their signature stays as a former student', async () => {
    const waiver = await mkWaiver(owner, school.id);
    expect((await sign(waiver.id, students[0])).status).toBe(201);
    await superuser.roleGrant.updateMany({ where: { userId: { in: [students[0].id, students[1].id] }, schoolId: school.id }, data: { revokedAt: new Date() } });

    const res = await signatures(waiver.id);
    expect(res.status).toBe(200);
    const byStudent = new Map(res.body.items.map((i: { studentId: string }) => [i.studentId, i]));
    expect(byStudent.get(students[1].id)).toBeUndefined();
    expect(byStudent.get(students[0].id)).toMatchObject({ status: 'SIGNED', formerStudent: true, signerFullName: 'Ann Review', studentName: null });
    expect(byStudent.get(students[2].id)).toMatchObject({ status: 'UNSIGNED', formerStudent: false, studentName: 'student2 Review' });
    expect(res.body.summary).toMatchObject({ total: 4, signed: 0, unsigned: 4 });

    await superuser.roleGrant.updateMany({ where: { userId: { in: [students[0].id, students[1].id] }, schoolId: school.id }, data: { revokedAt: null } });
  });

  it('Stress test round 4 (Q2): the Signatures panel comes one page at a time, A to Z, with the totals on the first page only, and filters and searches on the server', async () => {
    const waiver = await mkWaiver(owner, school.id, 'Paged');
    expect((await sign(waiver.id, students[3], { signerFullName: 'Zoë Parent', signatureText: 'Zoë Parent' })).status).toBe(201);
    expect((await sign(waiver.id, students[5])).status).toBe(201);
    const list = (query: string) => http().get(`/v1/schools/${school.id}/waivers/${waiver.id}/signatures?${query}`).set(auth(owner));
    const names = (res: request.Response) => res.body.items.map((i: { studentName: string | null; signerFullName: string | null }) => i.studentName ?? i.signerFullName);

    const first = await list('limit=2');
    expect(first.status).toBe(200);
    expect(names(first)).toEqual(['student0 Review', 'student1 Review']);
    expect(first.body.summary).toEqual({ total: 6, signed: 2, unsigned: 4, expired: 0, pending: 0 });
    const second = await list(`limit=2&cursor=${first.body.nextCursor}`);
    expect(names(second)).toEqual(['student2 Review', 'student3 Review']);
    expect(second.body.summary).toBeUndefined();
    const third = await list(`limit=2&cursor=${second.body.nextCursor}`);
    expect(names(third)).toEqual(['student4 Review', 'student5 Review']);
    expect(third.body.nextCursor).toBeNull();

    const signed = await list('filter=signed');
    expect(names(signed)).toEqual(['student3 Review', 'student5 Review']);
    expect(signed.body.summary).toMatchObject({ total: 6, signed: 2 }); // the whole roster, not the filtered list
    expect(names(await list('filter=unsigned'))).toEqual(['student0 Review', 'student1 Review', 'student2 Review', 'student4 Review']);
    expect(names(await list('q=zoe'))).toEqual(['student3 Review']); // the typed name, accents ignored
    expect(names(await list('q=STUDENT4'))).toEqual(['student4 Review']);
    expect(names(await list('q=%25'))).toEqual([]); // "%" is a plain character
    expect((await list('cursor=not-a-cursor')).status).toBe(400);
    expect((await list('filter=everyone')).status).toBe(400);

    // A former student's signature comes after everyone current.
    await superuser.roleGrant.updateMany({ where: { userId: students[5].id, schoolId: school.id }, data: { revokedAt: new Date() } });
    try {
      const all = await list('limit=100');
      expect(all.body.items.map((i: { studentId: string; formerStudent: boolean }) => [i.studentId, i.formerStudent])).toEqual([
        ...students.slice(0, 5).map((s) => [s.id, false]),
        [students[5].id, true],
      ]);
      expect(all.body.summary).toMatchObject({ total: 5, signed: 1 });
    } finally {
      await superuser.roleGrant.updateMany({ where: { userId: students[5].id, schoolId: school.id }, data: { revokedAt: null } });
    }
  });

  it('W3: a signature keeps the exact wording signed, and a signer who read an old version is sent back to read it again', async () => {
    const waiver = await mkWaiver(owner, school.id, 'Copy', 'Version ONE');
    expect(waiver.version).toBe(1);
    const signed = await sign(waiver.id, students[2], { waiverVersion: 1 });
    expect(signed.status).toBe(201);
    expect(signed.body).toMatchObject({
      signedWaiverTitle: 'Copy',
      signedWaiverBody: 'Version ONE',
      signedWaiverVersion: 1,
      signedWaiverSha256: createHash('sha256').update('Version ONE').digest('hex'),
    });

    const edited = await http().patch(`/v1/waivers/${waiver.id}`).set(auth(owner)).send({ body: 'Version TWO' });
    expect(edited.body.version).toBe(2);
    const titleOnlySame = await http().patch(`/v1/waivers/${waiver.id}`).set(auth(owner)).send({ body: 'Version TWO' });
    expect(titleOnlySame.body.version).toBe(2); // no change, no new version

    const row = await superuser.waiverSignature.findFirst({ where: { waiverId: waiver.id, studentId: students[2].id } });
    expect(row?.signedWaiverBody).toBe('Version ONE');

    // The list leaves the text out; opening one signature returns it, owner only.
    const listed = (await signatures(waiver.id)).body.items.find((i: { id: string }) => i.id === row!.id);
    expect(listed).toMatchObject({ signedWaiverVersion: 1, signedWaiverTitle: 'Copy' });
    expect(listed).not.toHaveProperty('signedWaiverBody');
    const one = (id: string, as: typeof owner) => http().get(`/v1/schools/${school.id}/waivers/${waiver.id}/signatures/${id}`).set(auth(as));
    const opened = await one(row!.id, owner);
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({ signedWaiverBody: 'Version ONE', studentName: 'student2 Review', formerStudent: false });
    expect((await one(row!.id, students[2])).status).toBe(403);
    expect((await one(randomUUID(), owner)).status).toBe(404);

    expect((await sign(waiver.id, students[3], { waiverVersion: 1 })).status).toBe(409);
    const fresh = await sign(waiver.id, students[3], { waiverVersion: 2 });
    expect(fresh.status).toBe(201);
    expect(fresh.body.signedWaiverBody).toBe('Version TWO');
    expect((await sign(waiver.id, students[4])).status).toBe(201); // older apps send no version
  });

  it('W4: a title or text of only spaces is refused, on add and on edit', async () => {
    for (const body of [{ title: '', body: '' }, { title: '   ', body: 'x' }, { title: 'x', body: '  \n ' }]) {
      expect((await http().post(`/v1/schools/${school.id}/waivers`).set(auth(owner)).send(body)).status).toBe(400);
    }
    const waiver = await mkWaiver(owner, school.id, '  Padded  ', ' Text ');
    const saved = await superuser.waiver.findUnique({ where: { id: waiver.id } });
    expect(saved).toMatchObject({ title: 'Padded', body: 'Text' });
    expect((await http().patch(`/v1/waivers/${waiver.id}`).set(auth(owner)).send({ title: '  ' })).status).toBe(400);
  });

  it('W5: a signature of only spaces is refused', async () => {
    const waiver = await mkWaiver(owner, school.id);
    expect((await sign(waiver.id, students[5], { signerFullName: '   ', signatureText: ' ' })).status).toBe(400);
  });

  it('W6: an archived waiver is not given to new members and cannot be signed; unarchiving assigns it to them', async () => {
    const waiver = await mkWaiver(emptyOwner, emptySchool.id, 'Old');
    expect((await http().post(`/v1/waivers/${waiver.id}/archive`).set(auth(emptyOwner))).status).toBe(201);
    const joiner = await mkUser('joiner', null);
    expect((await http().post(`/v1/schools/${emptySchool.id}/join`).set(auth(joiner)).send({})).status).toBe(201);
    expect(await superuser.waiverSignature.count({ where: { waiverId: waiver.id } })).toBe(0);

    const joinerToken = { ...joiner, token: jwt.sign({ sub: joiner.id, email: joiner.email, grants: [{ role: 'STUDENT', franchiseId: null, schoolId: emptySchool.id, branchId: null }] }) };
    const refused = await sign(waiver.id, joinerToken);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toBe('This waiver is no longer in use, so it can no longer be signed.');

    expect((await http().post(`/v1/waivers/${waiver.id}/unarchive`).set(auth(emptyOwner))).status).toBe(201);
    const rows = await superuser.waiverSignature.findMany({ where: { waiverId: waiver.id } });
    expect(rows.map((r) => [r.studentId, r.status])).toEqual([[joiner.id, 'UNSIGNED']]);
  });

  it('W7: the request notification names the School and the waiver', async () => {
    const waiver = await mkWaiver(owner, school.id, 'Adult Liability Waiver');
    fanoutAdds = [];
    const spy = jest.spyOn(app.get(getQueueToken(NOTIFICATION_FANOUT_QUEUE)), 'addBulk').mockImplementation(async (...args: unknown[]) => {
      const jobs = args[0];
      fanoutAdds.push(...(jobs as Array<{ data: { body: string } }>));
      return [] as never;
    });
    await app.get(WaiverSignatureRequestsProcessor).process({ data: { waiverId: waiver.id, schoolId: school.id } } as never);
    spy.mockRestore();
    // The app's own worker may also have run the job queued on create.
    expect(fanoutAdds.length).toBeGreaterThanOrEqual(students.length);
    expect(new Set(fanoutAdds.map((j) => j.data.body))).toEqual(new Set(['Review Dojo has invited you to sign the waiver "Adult Liability Waiver".']));
  });

  it('W10: signing is refused once the School is closed', async () => {
    const waiver = await mkWaiver(owner, school.id);
    await superuser.school.update({ where: { id: school.id }, data: { archivedAt: new Date() } });
    const res = await sign(waiver.id, students[5]);
    await superuser.school.update({ where: { id: school.id }, data: { archivedAt: null } });
    expect(res.status).toBe(403);
  });

  it('W11: includeArchived=false leaves archived waivers out (and =true keeps them)', async () => {
    const waiver = await mkWaiver(emptyOwner, emptySchool.id, 'Retire me');
    await superuser.waiverSignature.deleteMany({ where: { waiverId: waiver.id } });
    await http().post(`/v1/waivers/${waiver.id}/archive`).set(auth(emptyOwner));
    const ids = async (q: string) =>
      (await http().get(`/v1/schools/${emptySchool.id}/waivers?limit=100${q}`).set(auth(emptyOwner))).body.items.map((w: { id: string }) => w.id);
    expect(await ids('&includeArchived=false')).not.toContain(waiver.id);
    expect(await ids('&includeArchived=true')).toContain(waiver.id);
  });

  it('W13: a student who cannot sign is told why, without internal wording', async () => {
    const waiver = await mkWaiver(owner, school.id);
    const noDob = await mkUser('no-dob', school.id, 'STUDENT', null);
    const minor = await mkUser('minor', school.id, 'STUDENT', new Date(Date.now() - 10 * 365 * 24 * HOUR));
    const a = await sign(waiver.id, noDob);
    const b = await sign(waiver.id, minor);
    expect([a.status, b.status]).toEqual([403, 403]);
    expect(a.body.error.message).toBe('Add your date of birth to your profile before signing a waiver.');
    expect(b.body.error.message).toBe("You're under 18, so a parent or guardian needs to sign this waiver for you from their Guardian account.");
  });

  it('W15: a student without a signed waiver cannot join the waitlist of a class that needs one', async () => {
    const cls = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Sparring', startDate: new Date(Date.now() + 2 * HOUR), endDate: new Date(Date.now() + 3 * HOUR), capacity: 1, termsWaiverRequired: true },
    });
    await superuser.waiverSignature.deleteMany({ where: { schoolId: school.id, studentId: students[1].id, status: 'SIGNED' } });
    const m0 = await superuser.membership.findFirstOrThrow({ where: { studentId: students[0].id, schoolId: school.id } });
    await superuser.booking.create({ data: { id: randomUUID(), studentId: students[0].id, classId: cls.id, schoolId: school.id, sourceMembershipId: m0.id } });
    const res = await http().post(`/v1/classes/${cls.id}/waitlist`).set(auth(students[1])).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('This Student must hold a Signed Waiver for this School before joining the waitlist for this Class.');
    expect((await http().post(`/v1/classes/${cls.id}/waitlist`).set(auth(students[2])).send({})).status).toBe(201); // signed in W3
  });
});
