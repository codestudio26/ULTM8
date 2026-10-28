/**
 * Decision 381: the School's own display name and work phone for a staff
 * member, set by an owner on the Staff page. The person's account is never
 * changed.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP and JWT_ACCESS_SECRET — skips with a
 * warning if any are unset, same convention as every other e2e spec in this repo.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[staff-details.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('Staff display name and work phone (Decision 381)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const tag = randomUUID().slice(0, 8);

  type U = { id: string; email: string };
  type Grant = { role: string; schoolId: string; branchId: string | null };
  const http = () => request(app.getHttpServer());
  const as = (u: U, grants: Grant[]) => {
    const auth = `Bearer ${jwt.sign({ sub: u.id, email: u.email, grants: grants.map((g) => ({ franchiseId: null, ...g })) })}`;
    return {
      get: (url: string) => http().get(url).set('Authorization', auth),
      patch: (url: string) => http().patch(url).set('Authorization', auth),
    };
  };
  const owner = (schoolId: string): Grant[] => [{ role: 'SCHOOL_OWNER_MANAGER', schoolId, branchId: null }];

  const mkUser = (firstName: string) =>
    superuser.user.create({
      data: {
        id: randomUUID(),
        email: `staff-details-${firstName.toLowerCase()}-${tag}-${randomUUID().slice(0, 6)}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName,
        surname: 'Tester',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
  const grant = (userId: string, schoolId: string, role: 'SCHOOL_OWNER_MANAGER' | 'INSTRUCTOR' | 'BRANCH_STAFF', branchId: string | null = null) =>
    superuser.roleGrant.create({ data: { id: randomUUID(), role, userId, schoolId, branchId, isMainOwner: role === 'SCHOOL_OWNER_MANAGER' } });

  const seed = async (name: string) => {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: `Staff Details ${name} ${tag}` } });
    const branch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: `Main ${tag}` } });
    const own = await mkUser('Olga');
    await grant(own.id, school.id, 'SCHOOL_OWNER_MANAGER');
    const coach = await mkUser('Carlos');
    await grant(coach.id, school.id, 'INSTRUCTOR', branch.id);
    return { school, branch, own, coach };
  };
  const row = async (viewer: U, schoolId: string, userId: string, q?: string) => {
    const res = await as(viewer, owner(schoolId)).get(`/v1/schools/${schoolId}/staff${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    expect(res.status).toBe(200);
    return (res.body.items as { userId: string; displayName: string | null; workPhone: string | null; firstName: string; phone: string }[]).find(
      (i) => i.userId === userId,
    );
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationDeliveryService)
      .useValue({ sendEmail: async () => undefined })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    const schools = await superuser.school.findMany({ where: { name: { contains: tag } }, select: { id: true } });
    const ids = schools.map((s) => s.id);
    await superuser.staffPermission.deleteMany({ where: { schoolId: { in: ids } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: ids } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: ids } } });
    const users = await superuser.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
    await superuser.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: { in: ids } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('an owner sets, changes and clears the display name and work phone; the account is untouched', async () => {
    const { school, own, coach } = await seed('set');
    const url = `/v1/schools/${school.id}/staff/${coach.id}/details`;

    const before = await row(own, school.id, coach.id);
    expect(before).toMatchObject({ displayName: null, workPhone: null });

    const set = await as(own, owner(school.id)).patch(url).send({ displayName: '  Coach Carlos  ', workPhone: '+447911123456' });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ userId: coach.id, displayName: 'Coach Carlos', workPhone: '+447911123456' });
    expect(await row(own, school.id, coach.id)).toMatchObject({ displayName: 'Coach Carlos', workPhone: '+447911123456', firstName: 'Carlos', phone: coach.phone });

    // Search finds them by the display name too.
    expect(await row(own, school.id, coach.id, 'coach carl')).toBeDefined();

    // A field left out is unchanged; an empty string clears.
    const phoneOnly = await as(own, owner(school.id)).patch(url).send({ workPhone: '' });
    expect(phoneOnly.status).toBe(200);
    expect(phoneOnly.body).toMatchObject({ displayName: 'Coach Carlos', workPhone: null });
    const cleared = await as(own, owner(school.id)).patch(url).send({ displayName: null });
    expect(cleared.body).toMatchObject({ displayName: null, workPhone: null });

    const account = await superuser.user.findUniqueOrThrow({ where: { id: coach.id } });
    expect(account).toMatchObject({ firstName: 'Carlos', surname: 'Tester', phone: coach.phone });
  });

  it('keeps an existing "Can invite coaches" switch when details are set', async () => {
    const { school, branch, own } = await seed('perm');
    const staff = await mkUser('Bea');
    await grant(staff.id, school.id, 'BRANCH_STAFF', branch.id);
    await superuser.staffPermission.create({ data: { id: randomUUID(), schoolId: school.id, userId: staff.id, canInviteCoaches: true } });

    const res = await as(own, owner(school.id)).patch(`/v1/schools/${school.id}/staff/${staff.id}/details`).send({ displayName: 'Front desk Bea' });
    expect(res.status).toBe(200);
    const perm = await superuser.staffPermission.findUniqueOrThrow({ where: { schoolId_userId: { schoolId: school.id, userId: staff.id } } });
    expect(perm).toMatchObject({ canInviteCoaches: true, displayName: 'Front desk Bea' });
  });

  it('rejects a bad phone, a long name, a non-staff person and a non-owner', async () => {
    const { school, branch, own, coach } = await seed('reject');
    const url = `/v1/schools/${school.id}/staff/${coach.id}/details`;

    expect((await as(own, owner(school.id)).patch(url).send({ workPhone: '0770 090' })).status).toBe(400);
    expect((await as(own, owner(school.id)).patch(url).send({ displayName: 'x'.repeat(81) })).status).toBe(400);

    const stranger = await mkUser('Sam');
    expect((await as(own, owner(school.id)).patch(`/v1/schools/${school.id}/staff/${stranger.id}/details`).send({ displayName: 'Sam' })).status).toBe(404);

    // A coach can't set anyone's details, their own included.
    const asCoach = as(coach, [{ role: 'INSTRUCTOR', schoolId: school.id, branchId: branch.id }]);
    expect((await asCoach.patch(url).send({ displayName: 'Boss' })).status).toBe(403);

    // An owner of another School can't reach this one's staff.
    const other = await seed('other');
    expect((await as(other.own, owner(other.school.id)).patch(url).send({ displayName: 'Hi' })).status).toBe(403);
    expect(await row(own, school.id, coach.id)).toMatchObject({ displayName: null });
  });

  it('a person can read their own row, but not set it', async () => {
    const { school, own, coach } = await seed('self');
    await as(own, owner(school.id)).patch(`/v1/schools/${school.id}/staff/${coach.id}/details`).send({ displayName: 'Coach C' }).expect(200);
    // RLS: staff_permission_self_read — checked through the app role directly.
    const app = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
    try {
      const seen = await app.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.current_user_id', '${coach.id}', true)`);
        return tx.staffPermission.findMany({ where: { schoolId: school.id }, select: { userId: true, displayName: true } });
      });
      expect(seen).toEqual([{ userId: coach.id, displayName: 'Coach C' }]);
    } finally {
      await app.$disconnect();
    }
  });
});
