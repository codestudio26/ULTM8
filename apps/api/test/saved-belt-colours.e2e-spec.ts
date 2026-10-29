/**
 * Backlog 3.18 over real HTTP: each School keeps its own saved belt colours.
 * The owner, or Branch Staff who manage disciplines, replace the whole list;
 * anyone at the School reads it; another School never sees it. Codes are
 * stored in capitals with repeats dropped, and removing a saved colour
 * changes no belt already using it.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET.
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
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && process.env.JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[saved-belt-colours.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

describeIfDb('Saved belt colours (backlog 3.18)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const tag = `belt-colours-${randomUUID().slice(0, 8)}`;
  let school: { id: string };
  let other: { id: string };
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};

  const as = (who: string) => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);
    const server = () => request(app.getHttpServer());
    return {
      get: (path: string) => auth(server().get(path)),
      post: (path: string) => auth(server().post(path)),
      put: (path: string) => auth(server().put(path)),
    };
  };
  const url = (id: string) => `/v1/schools/${id}/belt-colours`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: tag, ranksToggle: true } });
    other = await superuser.school.create({ data: { id: randomUUID(), name: `${tag}-other`, ranksToggle: true } });
    const north = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'North' } });
    for (const label of ['owner', 'staff', 'coach', 'otherOwner']) {
      users[label] = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `${tag}-${label}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Colours',
          passcodeHash: 'x',
          dateOfBirth: new Date('1990-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
    }
    const grants = [
      { label: 'owner', role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id, branchId: null },
      { label: 'staff', role: 'BRANCH_STAFF', schoolId: school.id, branchId: north.id },
      { label: 'coach', role: 'INSTRUCTOR', schoolId: school.id, branchId: north.id },
      { label: 'otherOwner', role: 'SCHOOL_OWNER_MANAGER', schoolId: other.id, branchId: null },
    ] as const;
    for (const g of grants) {
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: g.role, userId: users[g.label].id, schoolId: g.schoolId, branchId: g.branchId } });
      tokens[g.label] = jwt.sign({ sub: users[g.label].id, email: users[g.label].email, grants: [{ role: g.role, franchiseId: null, schoolId: g.schoolId, branchId: g.branchId }] });
    }
  });

  afterAll(async () => {
    for (const id of [school.id, other.id]) {
      await superuser.rankStripeTier.deleteMany({ where: { schoolId: id } });
      await superuser.rank.deleteMany({ where: { schoolId: id } });
      await superuser.discipline.deleteMany({ where: { schoolId: id } });
      await superuser.staffPermission.deleteMany({ where: { schoolId: id } });
      await superuser.roleGrant.deleteMany({ where: { schoolId: id } });
      await superuser.branch.deleteMany({ where: { schoolId: id } });
    }
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: { in: [school.id, other.id] } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('starts empty; the owner saves the list in capitals with repeats dropped', async () => {
    expect((await as('owner').get(url(school.id))).body).toEqual({ colours: [] });
    const saved = await as('owner').put(url(school.id)).send({ colours: ['#2a9d8f', ' #E76F51 ', '#2A9D8F'] });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ colours: ['#2A9D8F', '#E76F51'] });
    // Every member of staff who edits belts sees the same list.
    expect((await as('coach').get(url(school.id))).body).toEqual({ colours: ['#2A9D8F', '#E76F51'] });
    expect((await as('staff').get(url(school.id))).body).toEqual({ colours: ['#2A9D8F', '#E76F51'] });
  });

  it('refuses codes that are not #RRGGBB, and more than 24', async () => {
    for (const colours of [['#2A9D8'], ['2A9D8F'], ['#GGGGGG'], ['red'], [12]]) {
      expect((await as('owner').put(url(school.id)).send({ colours })).status).toBe(400);
    }
    expect((await as('owner').put(url(school.id)).send({})).status).toBe(400);
    const many = Array.from({ length: 25 }, (_, i) => `#0000${i.toString(16).padStart(2, '0')}`);
    expect((await as('owner').put(url(school.id)).send({ colours: many })).status).toBe(400);
    expect((await as('owner').put(url(school.id)).send({ colours: many.slice(0, 24) })).status).toBe(200);
    await as('owner').put(url(school.id)).send({ colours: ['#2A9D8F', '#E76F51'] });
  });

  it('only the people who edit the ladder change it', async () => {
    expect((await as('coach').put(url(school.id)).send({ colours: [] })).status).toBe(403);
    expect((await as('staff').put(url(school.id)).send({ colours: [] })).status).toBe(403);
    await as('owner').put(`/v1/schools/${school.id}/staff-permissions/${users.staff.id}`).send({ canManageDisciplines: true });
    const edited = await as('staff').put(url(school.id)).send({ colours: ['#E76F51', '#264653'] });
    expect(edited.status).toBe(200);
    expect(edited.body).toEqual({ colours: ['#E76F51', '#264653'] });
    expect((await as('owner').get(url(school.id))).body).toEqual({ colours: ['#E76F51', '#264653'] });
  });

  it('another School never sees or changes them', async () => {
    expect([403, 404]).toContain((await as('otherOwner').get(url(school.id))).status);
    expect([403, 404]).toContain((await as('otherOwner').put(url(school.id)).send({ colours: ['#000000'] })).status);
    expect((await as('otherOwner').get(url(other.id))).body).toEqual({ colours: [] });
    expect((await as('owner').get(url(school.id))).body).toEqual({ colours: ['#E76F51', '#264653'] });
  });

  it('removing a saved colour leaves a belt using it unchanged', async () => {
    const style = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: `${tag} BJJ` } });
    const belt = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: style.id, schoolId: school.id, order: 0, name: 'Teal', primaryColour: '#264653' } });
    expect((await as('owner').put(url(school.id)).send({ colours: ['#E76F51'] })).body).toEqual({ colours: ['#E76F51'] });
    expect((await as('owner').get(`/v1/ranks/${belt.id}`)).body.primaryColour).toBe('#264653');
  });
});
