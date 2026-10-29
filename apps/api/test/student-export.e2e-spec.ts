/**
 * Export the student list (backlog 3.9; Decision 315 item 11, Decision 399):
 * the owner, or Branch Staff the owner allows; filters; the columns; a child's
 * Guardian; and the log of every export.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

type Role = 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'INSTRUCTOR' | 'STUDENT';

describeIfDb('Student list export', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const schoolId = randomUUID();
  let branchId: string;
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const exportAs = (who: string, filter?: string) =>
    http().get(`/v1/schools/${schoolId}/students/export`).query(filter ? { filter } : {}).set('Authorization', `Bearer ${tokens[who]}`);

  async function mkUser(label: string, opts: { email?: string; dateOfBirth?: Date } = {}) {
    users[label] = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: opts.email ?? `export-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Export',
        passcodeHash: 'x',
        dateOfBirth: opts.dateOfBirth ?? new Date('1990-04-02'),
        phoneVerifiedAt: new Date(),
      },
    });
  }

  async function grant(label: string, role: Role, extra: { branchId?: string; revokedAt?: Date } = {}) {
    await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: users[label].id, schoolId, branchId: extra.branchId ?? null, revokedAt: extra.revokedAt ?? null } });
    if (!extra.revokedAt) {
      tokens[label] = jwt.sign({ sub: users[label].id, email: users[label].email, grants: [{ role, franchiseId: null, schoolId, branchId: extra.branchId ?? null }] });
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.create({ data: { id: schoolId, name: 'Export School' } });
    branchId = (await superuser.branch.create({ data: { id: randomUUID(), schoolId, name: 'North' } })).id;
    for (const label of ['owner', 'staffOn', 'staffOff', 'coach', 'ana', 'vic', 'kid', 'parent', 'gone']) {
      await mkUser(label, label === 'kid' ? { email: `kid-${randomUUID()}@guardian-managed.ultm8.internal`, dateOfBirth: new Date('2016-01-01') } : {});
    }
    await grant('owner', 'SCHOOL_OWNER_MANAGER');
    await grant('staffOn', 'BRANCH_STAFF', { branchId });
    await grant('staffOff', 'BRANCH_STAFF', { branchId });
    await grant('coach', 'INSTRUCTOR');
    for (const s of ['ana', 'vic', 'kid']) await grant(s, 'STUDENT');
    await grant('gone', 'STUDENT', { revokedAt: new Date() });
    await superuser.staffPermission.create({ data: { id: randomUUID(), schoolId, userId: users.staffOn.id, canExportStudents: true } });
    for (const s of ['ana', 'vic', 'kid']) {
      await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId, studentId: users[s].id, branchId } });
    }
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: users.parent.id, studentId: users.kid.id } });

    // Ana: a live membership and an expired one, a belt, and a class she attended.
    const plan = (type: 'SUBSCRIPTION' | 'VISIT_PASS', title: string) =>
      superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId, type, title, price: type === 'VISIT_PASS' ? 0 : 5000 } });
    const unlimited = await plan('SUBSCRIPTION', 'Unlimited');
    const old = await plan('SUBSCRIPTION', 'Old plan');
    const pass = await plan('VISIT_PASS', 'Visit pass');
    await superuser.membership.createMany({
      data: [
        { id: randomUUID(), studentId: users.ana.id, membershipPlanId: unlimited.id, schoolId, status: 'ACTIVE', frequency: 'RECURRING' },
        { id: randomUUID(), studentId: users.ana.id, membershipPlanId: old.id, schoolId, status: 'EXPIRED', frequency: 'RECURRING' },
        { id: randomUUID(), studentId: users.vic.id, membershipPlanId: pass.id, schoolId, status: 'ACTIVE', frequency: 'ONE_TIME', expiryDate: new Date(Date.now() + 7 * 86_400_000) },
      ],
    });
    const bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId, name: 'BJJ', classTypesOffered: [] } });
    const blue = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId, order: 0, name: 'Blue', primaryColour: '#1E40AF' } });
    const tier = await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId: blue.id, schoolId, order: 0, count: 2, colour: '#000000', name: 'Blue 2', stripeSegments: [] } });
    await superuser.studentRank.create({ data: { id: randomUUID(), studentId: users.ana.id, disciplineId: bjj.id, schoolId, currentRankId: blue.id, currentStripeId: tier.id } });
    const start = new Date('2026-10-20T18:00:00.000Z');
    const cls = await superuser.class.create({ data: { id: randomUUID(), schoolId, title: 'Fundamentals', startDate: start, endDate: new Date(start.getTime() + 3_600_000) } });
    const source = await superuser.membership.findFirstOrThrow({ where: { studentId: users.ana.id, membershipPlanId: unlimited.id } });
    await superuser.booking.create({ data: { id: randomUUID(), studentId: users.ana.id, classId: cls.id, schoolId, status: 'COMPLETED', sourceMembershipId: source.id } });
  });

  afterAll(async () => {
    await superuser.studentExportLog.deleteMany({ where: { schoolId } });
    await superuser.booking.deleteMany({ where: { schoolId } });
    await superuser.class.deleteMany({ where: { schoolId } });
    await superuser.studentRank.deleteMany({ where: { schoolId } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId } });
    await superuser.rank.deleteMany({ where: { schoolId } });
    await superuser.discipline.deleteMany({ where: { schoolId } });
    await superuser.membership.deleteMany({ where: { schoolId } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId } });
    await superuser.guardianLink.deleteMany({ where: { studentId: users.kid.id } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId } });
    await superuser.staffPermission.deleteMany({ where: { schoolId } });
    await superuser.roleGrant.deleteMany({ where: { schoolId } });
    await superuser.branch.deleteMany({ where: { schoolId } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.delete({ where: { id: schoolId } });
    await superuser.$disconnect();
    await app.close();
  });

  const names = (body: { items: Array<{ firstName: string }> }) => body.items.map((r) => r.firstName).sort();

  it('the owner gets every column, children included, with their Guardian', async () => {
    const res = await exportAs('owner');
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(['ana', 'kid', 'vic']);
    const ana = res.body.items.find((r: { firstName: string }) => r.firstName === 'ana');
    expect(ana).toMatchObject({
      surname: 'Export',
      email: users.ana.email,
      dateOfBirth: '1990-04-02',
      status: 'ACTIVE',
      homeBranchName: 'North',
      visitor: false,
      memberships: ['Unlimited'],
      billingStatus: 'ACTIVE',
      belts: [{ style: 'BJJ', rank: 'Blue 2' }],
      lastVisitAt: '2026-10-20T18:00:00.000Z',
      guardians: [],
    });
    expect(ana.phone).toMatch(/^\+1555/);
    const kid = res.body.items.find((r: { firstName: string }) => r.firstName === 'kid');
    // A child's made-up email and phone are left out; their Guardian is there.
    expect(kid).toMatchObject({ email: '', phone: null, billingStatus: 'NONE', guardians: [{ name: 'parent Export', email: users.parent.email }] });
  });

  it('filters: all (with former students), members only, visitors only', async () => {
    expect(names((await exportAs('owner', 'ALL')).body)).toEqual(['ana', 'gone', 'kid', 'vic']);
    expect(names((await exportAs('owner', 'MEMBERS')).body)).toEqual(['ana', 'kid']);
    const visitors = (await exportAs('owner', 'VISITORS')).body;
    expect(names(visitors)).toEqual(['vic']);
    expect(visitors.items[0]).toMatchObject({ visitor: true, memberships: ['Visit pass'] });
    expect((await exportAs('owner', 'EVERYONE')).status).toBe(400);
  });

  it('Branch Staff need the owner\'s switch; coaches and students cannot export', async () => {
    const on = await exportAs('staffOn');
    expect(on.status).toBe(200);
    expect(names(on.body)).toEqual(['ana', 'kid', 'vic']);
    const off = await exportAs('staffOff');
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe('STAFF_ACCESS_OFF');
    expect((await exportAs('coach')).status).toBe(403);
    expect((await exportAs('ana')).status).toBe(403);
  });

  it('every export is logged with who, the filter and the row count', async () => {
    const before = await superuser.studentExportLog.count({ where: { schoolId } });
    await exportAs('staffOn', 'VISITORS');
    const logs = await superuser.studentExportLog.findMany({ where: { schoolId }, orderBy: { createdAt: 'desc' } });
    expect(logs).toHaveLength(before + 1);
    expect(logs[0]).toMatchObject({ exportedById: users.staffOn.id, filter: 'VISITORS', rowCount: 1 });
  });

  it('the switch shows on the staff member\'s access, and owners always have it', async () => {
    const mine = (who: string) => http().get(`/v1/schools/${schoolId}/staff/me/access`).set('Authorization', `Bearer ${tokens[who]}`);
    expect((await mine('staffOn')).body.access.exportStudents).toBe(true);
    expect((await mine('staffOff')).body.access.exportStudents).toBe(false);
    expect((await mine('owner')).body.access.exportStudents).toBe(true);
  });
});
