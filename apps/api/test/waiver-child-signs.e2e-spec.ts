/**
 * Decision 318 item 8: a School can let children sign their own waivers from
 * an age it sets (off by default: the Guardian signs). Real HTTP, real
 * Postgres.
 *
 * - Off: an under-18 student is refused as before, and a parent can't choose
 *   that the child signs.
 * - On: a child with their own login who is old enough signs themselves; a
 *   child without a login signs in their parent's app (`signedByChild`), and
 *   the signature records the child as the signer and the parent's account.
 * - A parent can still sign for the child as today.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { NOTIFICATION_FANOUT_QUEUE } from '../src/jobs/queue.constants';
import type { NotificationFanoutJobData } from '../src/jobs/notification-fanout.types';

const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[waiver-child-signs.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

const EMAIL_TAG = 'waiver-child-signs-';

describeIfDb('Children sign their own waivers from an age the School sets (Decision 318 item 8)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];

  const yearsAgo = (years: number) => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCFullYear(d.getUTCFullYear() - years);
    return d;
  };

  async function person(label: string, dateOfBirth: Date | null, grants: Array<{ role: 'SCHOOL_OWNER_MANAGER' | 'STUDENT'; schoolId: string }>) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `${EMAIL_TAG}${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Signer',
        passcodeHash: 'x',
        dateOfBirth,
        phoneVerifiedAt: new Date(),
      },
    });
    for (const g of grants) await superuser.roleGrant.create({ data: { id: randomUUID(), role: g.role, userId: u.id, schoolId: g.schoolId } });
    const token = jwt.sign({ sub: u.id, email: u.email, grants: grants.map((g) => ({ role: g.role, franchiseId: null, schoolId: g.schoolId, branchId: null })) });
    return { id: u.id, token };
  }

  /** A School, its owner, one waiver, a parent with two children (13 and 8)
   * and a 15-year-old with their own login. */
  async function setup(childSignsFromAge: number | null) {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: `Child signs ${randomUUID()}`, waiverChildSignsFromAge: childSignsFromAge } });
    schoolIds.push(school.id);
    const waiver = await superuser.waiver.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Liability', body: 'I agree.' } });
    const owner = await person('owner', yearsAgo(40), [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id }]);
    const teen = await person('teen', yearsAgo(15), [{ role: 'STUDENT', schoolId: school.id }]);
    const kid = await person('kid', yearsAgo(13), [{ role: 'STUDENT', schoolId: school.id }]);
    const little = await person('little', yearsAgo(8), [{ role: 'STUDENT', schoolId: school.id }]);
    const parent = await person('parent', yearsAgo(42), []);
    for (const child of [kid, little]) await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: parent.id, studentId: child.id } });
    return { school, waiver, owner, teen, kid, little, parent };
  }

  const sign = (token: string, waiverId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/v1/waivers/${waiverId}/sign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ signerFullName: 'Signer Name', signatureText: 'Signer Name', ...body });

  const minorWaivers = (token: string, studentId: string) =>
    request(app.getHttpServer()).get(`/v1/guardians/me/minors/${studentId}/waivers`).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    const users = (await superuser.user.findMany({ where: { email: { startsWith: EMAIL_TAG } }, select: { id: true } })).map((u) => u.id);
    await superuser.notification.deleteMany({ where: { userId: { in: users } } });
    await superuser.waiverSignature.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.waiver.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.guardianLink.deleteMany({ where: { studentId: { in: users } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: users } } });
    await superuser.user.deleteMany({ where: { id: { in: users } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('the owner turns it on with an age from 1 to 17; off is null, the default', async () => {
    const s = await setup(null);
    const settings = () => request(app.getHttpServer()).get(`/v1/schools/${s.school.id}/waiver-settings`).set('Authorization', `Bearer ${s.owner.token}`);
    const patch = (token: string, body: Record<string, unknown>) =>
      request(app.getHttpServer()).patch(`/v1/schools/${s.school.id}/waiver-settings`).set('Authorization', `Bearer ${token}`).send(body);

    expect((await settings()).body.waiverChildSignsFromAge).toBeNull();
    for (const bad of [0, 18, 12.5, 'twelve']) expect((await patch(s.owner.token, { waiverChildSignsFromAge: bad })).status).toBe(400);
    expect([403, 404]).toContain((await patch(s.teen.token, { waiverChildSignsFromAge: 12 })).status);

    const on = await patch(s.owner.token, { waiverChildSignsFromAge: 12 });
    expect(on.status).toBe(200);
    expect(on.body.waiverChildSignsFromAge).toBe(12);
    // Another setting saved alone leaves it as it is.
    expect((await patch(s.owner.token, { waiverNoticeOnJoin: false })).body.waiverChildSignsFromAge).toBe(12);
    expect((await patch(s.owner.token, { waiverChildSignsFromAge: null })).body.waiverChildSignsFromAge).toBeNull();
  });

  it('off: an under-18 student is refused as before, and a parent cannot choose that the child signs', async () => {
    const s = await setup(null);
    const self = await sign(s.teen.token, s.waiver.id, {});
    expect(self.status).toBe(403);
    expect(self.body.error.message).toMatch(/under 18/);

    const byChild = await sign(s.parent.token, s.waiver.id, { studentId: s.kid.id, signedByChild: true });
    expect(byChild.status).toBe(403);
    expect(byChild.body.error.message).toBe("This School doesn't let children sign their own waivers.");

    const list = await minorWaivers(s.parent.token, s.kid.id);
    expect(list.status).toBe(200);
    expect(list.body.items.map((w: { childMaySign: boolean }) => w.childMaySign)).toEqual([false]);

    // The parent still signs for the child, as today.
    const parentSigns = await sign(s.parent.token, s.waiver.id, { studentId: s.kid.id });
    expect(parentSigns.status).toBe(201);
    expect(parentSigns.body).toMatchObject({ studentId: s.kid.id, signedById: s.parent.id, signedViaGuardianId: null });
  });

  it('on: a child old enough signs with their own login; a younger one is still refused', async () => {
    const s = await setup(15);
    const teen = await sign(s.teen.token, s.waiver.id, {});
    expect(teen.status).toBe(201);
    expect(teen.body).toMatchObject({ studentId: s.teen.id, signedById: s.teen.id, signedViaGuardianId: null, status: 'SIGNED' });

    const younger = await setup(16);
    const refused = await sign(younger.teen.token, younger.waiver.id, {});
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toMatch(/under 18/);
  });

  it("on: a child signs in their parent's app; the signature is the child's, with the parent's account kept", async () => {
    const s = await setup(12);
    const list = await minorWaivers(s.parent.token, s.kid.id);
    expect(list.body.items.map((w: { childMaySign: boolean }) => w.childMaySign)).toEqual([true]);
    expect((await minorWaivers(s.parent.token, s.little.id)).body.items.map((w: { childMaySign: boolean }) => w.childMaySign)).toEqual([false]);

    const res = await sign(s.parent.token, s.waiver.id, { studentId: s.kid.id, signedByChild: true, signerFullName: 'kid Signer' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ studentId: s.kid.id, signedById: s.kid.id, signedViaGuardianId: s.parent.id, signerFullName: 'kid Signer', status: 'SIGNED' });

    // Saved on the row, with the child's 18th birthday (Decision 426 item 5).
    const row = await superuser.waiverSignature.findFirstOrThrow({ where: { waiverId: s.waiver.id, studentId: s.kid.id, status: 'SIGNED' } });
    expect(row).toMatchObject({ signedById: s.kid.id, signedViaGuardianId: s.parent.id });
    expect(row.studentMajorityDate).not.toBeNull();

    // The owner's Signatures list shows it.
    const panel = await request(app.getHttpServer())
      .get(`/v1/schools/${s.school.id}/waivers/${s.waiver.id}/signatures`)
      .set('Authorization', `Bearer ${s.owner.token}`);
    expect(panel.status).toBe(200);
    expect(panel.body.items.find((i: { studentId: string }) => i.studentId === s.kid.id)).toMatchObject({ signedById: s.kid.id, signedViaGuardianId: s.parent.id });

    // Too young for the School's age.
    const little = await sign(s.parent.token, s.waiver.id, { studentId: s.little.id, signedByChild: true });
    expect(little.status).toBe(403);
    expect(little.body.error.message).toBe("This child isn't old enough yet to sign this School's waivers themselves.");
    // The parent can still sign for them.
    expect((await sign(s.parent.token, s.waiver.id, { studentId: s.little.id })).body).toMatchObject({ signedById: s.parent.id, signedViaGuardianId: null });
  });

  it('only a linked parent can choose that the child signs', async () => {
    const s = await setup(12);
    const notParent = await person('stranger', yearsAgo(40), []);
    expect((await sign(notParent.token, s.waiver.id, { studentId: s.kid.id, signedByChild: true })).status).toBe(403);

    const alone = await sign(s.teen.token, s.waiver.id, { signedByChild: true });
    expect(alone.status).toBe(400);
    expect(alone.body.error.message).toBe('Only a parent signing for their child can choose that the child signs.');
  });

  describe('Decision 435 item 30: the parents are told when their child signs', () => {
    let addBulk: jest.SpyInstance;
    beforeEach(() => {
      addBulk = jest.spyOn(app.get<Queue>(getQueueToken(NOTIFICATION_FANOUT_QUEUE)), 'addBulk').mockResolvedValue([] as never);
    });
    afterEach(() => addBulk.mockRestore());
    const told = () => addBulk.mock.calls.flatMap((c) => (c[0] as Array<{ data: NotificationFanoutJobData }>).map((j) => j.data));

    it("a child signing in a parent's app: every parent of theirs, as a notice about the child", async () => {
      const s = await setup(12);
      const other = await person('otherparent', yearsAgo(44), []);
      await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: other.id, studentId: s.kid.id } });
      const res = await sign(s.parent.token, s.waiver.id, { studentId: s.kid.id, signedByChild: true });
      expect(res.status).toBe(201);
      const notices = told();
      expect(notices.map((n) => n.userId).sort()).toEqual([s.parent.id, other.id].sort());
      expect(notices[0]).toMatchObject({
        title: 'Waiver signed by your child',
        body: `kid signed the waiver "Liability" at ${s.school.name}.`,
        guardianCopyOf: s.kid.id,
        schoolId: s.school.id,
        targetType: 'WAIVER',
        targetId: s.waiver.id,
      });
    });

    it('a teen signing with their own login: their parent is told', async () => {
      const s = await setup(15);
      await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: s.parent.id, studentId: s.teen.id } });
      expect((await sign(s.teen.token, s.waiver.id, {})).status).toBe(201);
      expect(told().map((n) => n.userId)).toEqual([s.parent.id]);
    });

    it('nobody when the parent signs for the child, or an adult signs', async () => {
      const s = await setup(12);
      expect((await sign(s.parent.token, s.waiver.id, { studentId: s.kid.id })).status).toBe(201);
      const adult = await person('adultstudent', yearsAgo(30), [{ role: 'STUDENT', schoolId: s.school.id }]);
      // An adult who still has a parent link on file is not a child.
      await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: s.parent.id, studentId: adult.id } });
      expect((await sign(adult.token, s.waiver.id, {})).status).toBe(201);
      expect(told()).toEqual([]);
    });
  });

  it('a child with no date of birth on file cannot sign themselves', async () => {
    const s = await setup(12);
    await superuser.user.update({ where: { id: s.kid.id }, data: { dateOfBirth: null } });
    const res = await sign(s.parent.token, s.waiver.id, { studentId: s.kid.id, signedByChild: true });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("Add the child's date of birth before they sign a waiver themselves.");
    expect((await minorWaivers(s.parent.token, s.kid.id)).body.items.map((w: { childMaySign: boolean }) => w.childMaySign)).toEqual([false]);
  });
});
