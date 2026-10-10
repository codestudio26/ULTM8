/**
 * The Grading Board for staff in one query (Phase 7 stress round, finding 1;
 * grading_board_rows): the same students as before (Decisions 168, 169, 177)
 * and, for each, exactly what the owner's board shows. Real HTTP.
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
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[grading-board-staff.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

type Grant = { role: 'SCHOOL_OWNER_MANAGER' | 'INSTRUCTOR' | 'BRANCH_STAFF' | 'STUDENT'; schoolId: string; branchId?: string | null; revokedAt?: Date };

describeIfDb('Grading Board for staff, one query (Phase 7)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const userIds: string[] = [];

  async function person(first: string, grants: Grant[]) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `board-staff-${first}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: first,
        surname: 'Board',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    for (const g of grants) {
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: g.role, userId: u.id, schoolId: g.schoolId, branchId: g.branchId ?? null, revokedAt: g.revokedAt ?? null } });
    }
    const token = jwt.sign({
      sub: u.id,
      email: u.email,
      grants: grants.filter((g) => !g.revokedAt).map((g) => ({ role: g.role, franchiseId: null, schoolId: g.schoolId, branchId: g.branchId ?? null })),
    });
    return { id: u.id, token };
  }

  /** A School with one style of 3 rungs (10 classes each). */
  async function schoolWithStyle(name: string, branchNames: string[]) {
    const school = await superuser.school.create({ data: { id: randomUUID(), name, ranksToggle: true, timezone: 'Europe/London' } });
    schoolIds.push(school.id);
    const branches: Array<{ id: string }> = [];
    for (const b of branchNames) branches.push(await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: b, timezone: 'Asia/Tokyo' } }));
    const style = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ' } });
    const rank = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: style.id, schoolId: school.id, order: 0, name: 'White', primaryColour: '#FFFFFF' } });
    const rungs: Array<{ id: string }> = [];
    for (let t = 0; t < 3; t++) {
      rungs.push(
        await superuser.rankStripeTier.create({
          data: { id: randomUUID(), rankId: rank.id, schoolId: school.id, order: t, count: t, colour: '#000000', name: `White ${t}`, classesRequired: 10, minimumDaysInRank: 30 },
        }),
      );
    }
    const owner = await person(`${name}-owner`, [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id }]);
    return { school, branches, style, rank, rungs, owner };
  }

  async function enrol(
    s: Awaited<ReturnType<typeof schoolWithStyle>>,
    first: string,
    opts: { home?: string; classes?: number; daysAgo?: number; revoked?: boolean; membership?: boolean } = {},
  ) {
    const st = await person(first, [{ role: 'STUDENT', schoolId: s.school.id, revokedAt: opts.revoked ? new Date() : undefined }]);
    if (opts.home) await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.school.id, studentId: st.id, branchId: opts.home } });
    await superuser.studentRank.create({
      data: {
        id: randomUUID(), studentId: st.id, disciplineId: s.style.id, schoolId: s.school.id,
        currentRankId: s.rank.id, currentStripeId: s.rungs[0].id,
        classesAttendedTowardCheckpoint: opts.classes ?? 0,
        dateOfCurrentRank: new Date(Date.now() - (opts.daysAgo ?? 0) * 86_400_000),
      },
    });
    if (opts.membership) {
      const plan = await superuser.membershipPlan.create({
        data: { id: randomUUID(), schoolId: s.school.id, title: `Plan ${first}`, type: 'SUBSCRIPTION', price: 1000, currency: 'GBP' },
      });
      await superuser.membership.create({ data: { id: randomUUID(), studentId: st.id, membershipPlanId: plan.id, schoolId: s.school.id, frequency: 'RECURRING' } });
    }
    return st;
  }

  const board = (s: { school: { id: string }; style: { id: string } }, token: string) =>
    request(app.getHttpServer()).get(`/v1/schools/${s.school.id}/grading-board?disciplineId=${s.style.id}`).set('Authorization', `Bearer ${token}`);
  const ids = (res: request.Response) => (res.body.items as Array<{ studentId: string }>).map((i) => i.studentId).sort();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await superuser.membership.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentRank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('with branches: a coach sees their branches\' students, exactly as the owner sees them', async () => {
    const s = await schoolWithStyle('Branches', ['North', 'South']);
    const [north, south] = s.branches;
    const a = await enrol(s, 'Ana', { home: north.id, classes: 7, daysAgo: 45, membership: true });
    const b = await enrol(s, 'Ben', { home: north.id, classes: 2, daysAgo: 3 });
    await enrol(s, 'Cat', { home: south.id, classes: 9 });
    await enrol(s, 'Dan', {}); // no home branch: owner only
    await enrol(s, 'Eve', { home: north.id, revoked: true }); // left the School
    const coach = await person('NorthCoach', [{ role: 'INSTRUCTOR', schoolId: s.school.id, branchId: north.id }]);
    const wide = await person('WideStaff', [{ role: 'BRANCH_STAFF', schoolId: s.school.id, branchId: null }]);

    const mine = await board(s, coach.token);
    expect(mine.status).toBe(200);
    expect(ids(mine)).toEqual([a.id, b.id].sort());

    // Same rows as the owner's board for those students: progress, column,
    // days, time zone and membership all read the same.
    const all = await board(s, s.owner.token);
    for (const item of mine.body.items) {
      expect(item).toEqual(all.body.items.find((o: { studentId: string }) => o.studentId === item.studentId));
    }
    expect(mine.body.items.find((i: { studentId: string }) => i.studentId === a.id)).toMatchObject({ hasActiveMembership: true, active: true });

    // A School-wide staff grant covers no branch's students.
    expect(ids(await board(s, wide.token))).toEqual([]);
  });

  it('without branches: a coach sees every current student; others see nothing', async () => {
    const s = await schoolWithStyle('NoBranches', []);
    const a = await enrol(s, 'Fay', { classes: 5 });
    const b = await enrol(s, 'Gus', { classes: 10 });
    await enrol(s, 'Hal', { revoked: true });
    const coach = await person('PlainCoach', [{ role: 'INSTRUCTOR', schoolId: s.school.id }]);
    const other = await schoolWithStyle('Elsewhere', []);
    const outsider = await person('Outsider', [{ role: 'INSTRUCTOR', schoolId: other.school.id }]);
    const formerCoach = await person('Former', [{ role: 'INSTRUCTOR', schoolId: s.school.id, revokedAt: new Date() }]);

    const mine = await board(s, coach.token);
    expect(ids(mine)).toEqual([a.id, b.id].sort());
    expect(mine.body.items).toEqual((await board(s, s.owner.token)).body.items);
    expect([403, 404]).toContain((await board(s, outsider.token)).status);
    expect([403, 404]).toContain((await board(s, formerCoach.token)).status);
  });

  it('the function itself answers nothing to a caller with no staff grant at the School', async () => {
    const s = await schoolWithStyle('Direct', []);
    await enrol(s, 'Ivy', { classes: 1 });
    const student = await person('Nosy', [{ role: 'STUDENT', schoolId: s.school.id }]);
    const app_ = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_APP });
    try {
      const rows = await app_.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${student.id}'`);
        return tx.$queryRaw<unknown[]>`SELECT * FROM grading_board_rows(${s.school.id}, ${s.style.id})`;
      });
      expect(rows).toEqual([]);
    } finally {
      await app_.$disconnect();
    }
  });
});
