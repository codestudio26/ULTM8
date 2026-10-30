/**
 * Disciplines review fixes (Decisions 308, 309) over real HTTP: blank and
 * repeated names, class types that are renamed or removed, a renamed style
 * carried onto classes and instructors, archived belts left out of grading,
 * a belt added after the purge job left a gap, archiving a whole style, and
 * skill order and lesson counts. Then the leftovers (Decision 310): archived
 * styles can't be newly picked, students who left aren't counted, and the
 * student app's view of an archived style.
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
import { EntityOffboardingPurgeProcessor } from '../src/jobs/entity-offboarding-purge.processor';
import { giveLiveMemberships } from './live-membership';

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && process.env.JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[disciplines-review.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

describeIfDb('Disciplines review fixes (Decisions 308, 309)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const tag = `disc-review-${randomUUID().slice(0, 8)}`;
  let school: { id: string };
  let tokOwner: string;
  let tokStudent: string;
  let tokInstructor: string;
  let studentId: string;
  let instructorUserId: string;

  const http = () => request(app.getHttpServer());
  const owner = {
    post: (path: string) => http().post(path).set('Authorization', `Bearer ${tokOwner}`),
    patch: (path: string) => http().patch(path).set('Authorization', `Bearer ${tokOwner}`),
    put: (path: string) => http().put(path).set('Authorization', `Bearer ${tokOwner}`),
    get: (path: string) => http().get(path).set('Authorization', `Bearer ${tokOwner}`),
  };
  const newStyle = (body: Record<string, unknown>) => owner.post(`/v1/schools/${school.id}/disciplines`).send(body);
  const newBelt = (disciplineId: string, order: number, name: string, extra: Record<string, unknown> = {}) =>
    owner.post(`/v1/styles/${disciplineId}/ranks`).send({
      order,
      name,
      primaryColour: '#FFFFFF',
      stripeTiers: [{ order: 0, count: 0, colour: '#FFFFFF', classesRequired: 1, ...extra }],
    });
  const tomorrow = () => new Date(Date.now() + 86_400_000);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: tag, ranksToggle: true, defaultCurrency: 'GBP' } });
    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `${tag}-${label}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Review',
          passcodeHash: 'x',
          dateOfBirth: new Date('1990-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
    const o = await mkUser('owner');
    const s = await mkUser('student');
    const i = await mkUser('instructor');
    studentId = s.id;
    instructorUserId = i.id;
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: o.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: s.id, schoolId: school.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: i.id, schoolId: school.id },
      ],
    });
    await giveLiveMemberships(superuser, school.id, [s.id]);
    const sign = (u: { id: string; email: string }, role: string) =>
      jwt.sign({ sub: u.id, email: u.email, grants: [{ role, franchiseId: null, schoolId: school.id, branchId: null }] });
    tokOwner = sign(o, 'SCHOOL_OWNER_MANAGER');
    tokStudent = sign(s, 'STUDENT');
    tokInstructor = sign(i, 'INSTRUCTOR');
  });

  afterAll(async () => {
    const id = school.id;
    await superuser.promotionEvent.deleteMany({ where: { schoolId: id } });
    await superuser.studentRankSkillStatus.deleteMany({ where: { schoolId: id } });
    await superuser.studentRank.deleteMany({ where: { schoolId: id } });
    await superuser.gradingPermission.deleteMany({ where: { schoolId: id } });
    await superuser.instructor.deleteMany({ where: { schoolId: id } });
    await superuser.class.deleteMany({ where: { schoolId: id } });
    await superuser.timetableSlot.deleteMany({ where: { schoolId: id } });
    await superuser.rankStripeTierRequiredSkill.deleteMany({ where: { skill: { schoolId: id } } });
    await superuser.skill.deleteMany({ where: { schoolId: id } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: id } });
    await superuser.rank.deleteMany({ where: { schoolId: id } });
    await superuser.discipline.deleteMany({ where: { schoolId: id } });
    await superuser.membership.deleteMany({ where: { schoolId: id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: id } });
    const users = (await superuser.user.findMany({ where: { email: { contains: tag } }, select: { id: true } })).map((u) => u.id);
    await superuser.notification.deleteMany({ where: { userId: { in: users } } });
    await superuser.user.deleteMany({ where: { id: { in: users } } });
    await superuser.school.delete({ where: { id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('names: blank refused, trimmed, unique per School (any capitals); class types cleaned (Decision 308)', async () => {
    expect((await newStyle({ name: '   ' })).status).toBe(400);
    const judo = await newStyle({ name: '  Judo  ', classTypesOffered: ['Kids', 'kids', '', ' Adults ', 'Kids'] });
    expect(judo.status).toBe(201);
    expect(judo.body.name).toBe('Judo');
    expect(judo.body.classTypesOffered).toEqual(['Kids', 'Adults']);
    expect(judo.body.studentCount).toBe(0);
    const again = await newStyle({ name: 'JUDO' });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toContain('already exists');

    const other = await newStyle({ name: 'Karate' });
    expect((await owner.patch(`/v1/disciplines/${other.body.id}`).send({ name: 'judo' })).status).toBe(409);
    // Changing only the capitals of its own name is fine.
    expect((await owner.patch(`/v1/disciplines/${other.body.id}`).send({ name: 'KARATE' })).status).toBe(200);

    expect((await owner.post(`/v1/styles/${judo.body.id}/skills`).send({ name: '  ' })).status).toBe(400);
    expect((await owner.post(`/v1/styles/${judo.body.id}/skills`).send({ name: 'Osoto gari' })).status).toBe(201);
    expect((await owner.post(`/v1/styles/${judo.body.id}/skills`).send({ name: 'osoto GARI' })).status).toBe(409);
  });

  it('null on update is a 400, not a 500 (Decision 308)', async () => {
    const d = await newStyle({ name: 'Nulls' });
    for (const body of [{ name: null }, { classTypesOffered: null }, { skillsRequiredToGrade: null }]) {
      expect((await owner.patch(`/v1/disciplines/${d.body.id}`).send(body)).status).toBe(400);
    }
    const sk = await owner.post(`/v1/styles/${d.body.id}/skills`).send({ name: 'A' });
    expect((await owner.patch(`/v1/skills/${sk.body.id}`).send({ name: null })).status).toBe(400);
  });

  it('duplicate and template names stay unique and within 100 characters (Decision 308)', async () => {
    const long = await newStyle({ name: 'L'.repeat(100) });
    const copy1 = await owner.post(`/v1/disciplines/${long.body.id}/duplicate`);
    const copy2 = await owner.post(`/v1/disciplines/${long.body.id}/duplicate`);
    expect(copy1.status).toBe(201);
    expect(copy1.body.name).toHaveLength(100);
    expect(copy1.body.name.endsWith(' (Copy)')).toBe(true);
    expect(copy2.body.name.endsWith(' (Copy 2)')).toBe(true);
    // The copy can be saved again as it is.
    expect((await owner.patch(`/v1/disciplines/${copy1.body.id}`).send({ name: copy1.body.name })).status).toBe(200);

    const t1 = await owner.post(`/v1/schools/${school.id}/disciplines/from-template`).send({ templateId: 'ibjjf_kids_red' });
    const t2 = await owner.post(`/v1/schools/${school.id}/disciplines/from-template`).send({ templateId: 'ibjjf_kids_red' });
    expect(t1.status).toBe(201);
    expect(t2.status).toBe(201);
    expect(t2.body.name).toBe(`${t1.body.name} (2)`);
    expect((await owner.post(`/v1/schools/${school.id}/disciplines/from-template`).send({ templateId: 'ibjjf', name: t1.body.name })).status).toBe(409);
    expect((await owner.post(`/v1/schools/${school.id}/disciplines/from-template`).send({ templateId: 'ibjjf', name: '  ' })).status).toBe(400);
  });

  it('a renamed style is carried onto its classes, slots and instructors (Decision 308)', async () => {
    const d = await newStyle({ name: 'BJJ', classTypesOffered: ['Adults'] });
    const cls = await owner.post(`/v1/schools/${school.id}/classes`).send({
      title: 'Evening BJJ',
      styles: [{ disciplineId: d.body.id, classType: 'Adults' }],
      startDate: tomorrow().toISOString(),
      endDate: new Date(tomorrow().getTime() + 3_600_000).toISOString(),
    });
    expect(cls.status).toBe(201);
    expect(cls.body.activities).toEqual(['BJJ']);
    await superuser.instructor.create({
      data: { id: randomUUID(), userId: instructorUserId, schoolId: school.id, specializationStyleIds: [d.body.id], specializations: ['BJJ'] },
    });

    expect((await owner.patch(`/v1/disciplines/${d.body.id}`).send({ name: 'Brazilian Jiu-Jitsu' })).status).toBe(200);
    expect((await superuser.class.findUniqueOrThrow({ where: { id: cls.body.id } })).activities).toEqual(['Brazilian Jiu-Jitsu']);
    expect((await superuser.instructor.findFirstOrThrow({ where: { schoolId: school.id, userId: instructorUserId } })).specializations).toEqual([
      'Brazilian Jiu-Jitsu',
    ]);
    const filtered = await owner.get(`/v1/schools/${school.id}/classes?activities=${encodeURIComponent('Brazilian Jiu-Jitsu')}`);
    expect(filtered.body.items.map((c: { id: string }) => c.id)).toContain(cls.body.id);
  });

  it('class types: a used one can\'t just be removed; a rename carries onto classes, slots and rungs (Decision 309)', async () => {
    const d = await newStyle({ name: 'Wrestling', classTypesOffered: ['Kids', 'Adults'] });
    const cls = await owner.post(`/v1/schools/${school.id}/classes`).send({
      title: 'Kids Wrestling',
      styles: [{ disciplineId: d.body.id, classType: 'Kids' }],
      startDate: tomorrow().toISOString(),
      endDate: new Date(tomorrow().getTime() + 3_600_000).toISOString(),
    });
    expect(cls.status).toBe(201);
    const belt = await newBelt(d.body.id, 0, 'White', { eligibleClassTypes: ['Kids'], bookingUnlocksClassTypes: ['Kids'] });
    expect(belt.status).toBe(201);

    const removed = await owner.patch(`/v1/disciplines/${d.body.id}`).send({ classTypesOffered: ['Adults'] });
    expect(removed.status).toBe(409);
    expect(removed.body.error.message).toContain('"Kids" is still in use (upcoming classes: 1, timetable slots: 0, rungs on the ladder: 1)');

    // Renaming to a type that already exists is refused (no silent merge).
    expect(
      (await owner.patch(`/v1/disciplines/${d.body.id}`).send({ classTypesOffered: ['Adults'], renameClassTypes: [{ from: 'Kids', to: 'Adults' }] })).status,
    ).toBe(400);

    const renamed = await owner
      .patch(`/v1/disciplines/${d.body.id}`)
      .send({ classTypesOffered: ['Kids Fundamentals', 'Adults'], renameClassTypes: [{ from: 'Kids', to: 'Kids Fundamentals' }] });
    expect(renamed.status).toBe(200);
    expect(renamed.body.classTypesOffered).toEqual(['Kids Fundamentals', 'Adults']);
    expect((await superuser.class.findUniqueOrThrow({ where: { id: cls.body.id } })).styles).toEqual([
      { disciplineId: d.body.id, classType: 'Kids Fundamentals' },
    ]);
    const tier = await superuser.rankStripeTier.findFirstOrThrow({ where: { rankId: belt.body.id } });
    expect(tier.eligibleClassTypes).toEqual(['Kids Fundamentals']);
    expect(tier.bookingUnlocksClassTypes).toEqual(['Kids Fundamentals']);
    // An unused type can be removed.
    expect((await owner.patch(`/v1/disciplines/${d.body.id}`).send({ classTypesOffered: ['Kids Fundamentals'] })).status).toBe(200);
  });

  it('an archived belt is not part of the ladder: no promoting or declaring into it (Decision 308)', async () => {
    const d = await newStyle({ name: 'Archive Ladder' });
    const white = await newBelt(d.body.id, 0, 'White');
    const grey = await newBelt(d.body.id, 1, 'Grey');
    const blue = await newBelt(d.body.id, 2, 'Blue');
    expect((await owner.post(`/v1/ranks/${grey.body.id}/archive`)).status).toBe(201);

    const options = await http().get(`/v1/students/${studentId}/ranks/declare-options?schoolId=${school.id}`).set('Authorization', `Bearer ${tokStudent}`);
    const style = options.body.items.find((i: { disciplineId: string }) => i.disciplineId === d.body.id);
    expect(style.ladder.map((r: { beltName: string }) => r.beltName)).toEqual(['White', 'Blue']);
    const declareGrey = await http()
      .post(`/v1/students/${studentId}/ranks/${d.body.id}/declare`)
      .set('Authorization', `Bearer ${tokStudent}`)
      .send({ rankId: grey.body.id, stripeTierId: grey.body.stripeTiers[0].id });
    expect(declareGrey.status).toBe(400);

    const declared = await http()
      .post(`/v1/students/${studentId}/ranks/${d.body.id}/declare`)
      .set('Authorization', `Bearer ${tokStudent}`)
      .send({ rankId: white.body.id, stripeTierId: white.body.stripeTiers[0].id });
    expect(declared.status).toBe(201);
    const promoted = await owner.post(`/v1/students/${studentId}/ranks/${d.body.id}/promote`).send({ acknowledgeWithoutSkillSignoff: true });
    expect(promoted.status).toBe(201);
    const held = await superuser.studentRank.findFirstOrThrow({ where: { studentId, disciplineId: d.body.id } });
    expect(held.currentRankId).toBe(blue.body.id);
  });

  it('after the purge job removes a middle belt, a belt can still be added at the end (Decision 308)', async () => {
    const d = await newStyle({ name: 'Purge Gap' });
    await newBelt(d.body.id, 0, 'White');
    const grey = await newBelt(d.body.id, 1, 'Grey');
    await newBelt(d.body.id, 2, 'Blue');
    await owner.post(`/v1/ranks/${grey.body.id}/archive`);
    await superuser.rank.update({ where: { id: grey.body.id }, data: { purgeAt: new Date(Date.now() - 1000) } });
    await app.get(EntityOffboardingPurgeProcessor).process({ data: {}, attemptsMade: 1, opts: { attempts: 3 } } as never);
    expect(await superuser.rank.findUnique({ where: { id: grey.body.id } })).toBeNull();

    const added = await newBelt(d.body.id, 2, 'Purple');
    expect(added.status).toBe(201);
    const orders = (await superuser.rank.findMany({ where: { disciplineId: d.body.id }, orderBy: { order: 'asc' } })).map((r) => [r.name, r.order]);
    expect(orders).toEqual([
      ['White', 0],
      ['Blue', 1],
      ['Purple', 2],
    ]);
  });

  it('archiving a style: refused while a live class uses it; then hidden, read-only and not gradable; unarchive restores it (Decision 309)', async () => {
    const d = await newStyle({ name: 'Taekwondo' });
    const white = await newBelt(d.body.id, 0, 'White');
    await newBelt(d.body.id, 1, 'Yellow');
    await http()
      .post(`/v1/students/${studentId}/ranks/${d.body.id}/declare`)
      .set('Authorization', `Bearer ${tokStudent}`)
      .send({ rankId: white.body.id, stripeTierId: white.body.stripeTiers[0].id });
    const cls = await owner.post(`/v1/schools/${school.id}/classes`).send({
      title: 'TKD',
      styles: [{ disciplineId: d.body.id }],
      startDate: tomorrow().toISOString(),
      endDate: new Date(tomorrow().getTime() + 3_600_000).toISOString(),
    });
    expect(cls.status).toBe(201);

    const blocked = await owner.post(`/v1/disciplines/${d.body.id}/archive`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toContain('This style is still in use (upcoming classes: 1, timetable slots: 0)');
    expect((await owner.post(`/v1/classes/${cls.body.id}/archive`)).status).toBe(201);

    const archived = await owner.post(`/v1/disciplines/${d.body.id}/archive`);
    expect(archived.status).toBe(201);
    expect(archived.body.archivedAt).not.toBeNull();
    expect(archived.body.studentCount).toBe(1);

    const list = await owner.get(`/v1/schools/${school.id}/disciplines`);
    expect(list.body.items.map((x: { id: string }) => x.id)).not.toContain(d.body.id);
    const all = await owner.get(`/v1/schools/${school.id}/disciplines?includeArchived=true`);
    expect(all.body.items.map((x: { id: string }) => x.id)).toContain(d.body.id);

    expect((await owner.patch(`/v1/disciplines/${d.body.id}`).send({ name: 'TKD' })).status).toBe(409);
    expect((await newBelt(d.body.id, 2, 'Green')).status).toBe(409);
    expect((await owner.post(`/v1/styles/${d.body.id}/skills`).send({ name: 'Kick' })).status).toBe(409);
    const promote = await owner.post(`/v1/students/${studentId}/ranks/${d.body.id}/promote`).send({ acknowledgeWithoutSkillSignoff: true });
    expect(promote.status).toBe(409);
    expect(promote.body.error.message).toContain('archived');
    const newClass = await owner.post(`/v1/schools/${school.id}/classes`).send({
      title: 'TKD 2',
      styles: [{ disciplineId: d.body.id }],
      startDate: tomorrow().toISOString(),
      endDate: new Date(tomorrow().getTime() + 3_600_000).toISOString(),
    });
    expect(newClass.status).toBe(400);
    // The student's rank is still there to read.
    const ranks = await http().get(`/v1/students/${studentId}/ranks?schoolId=${school.id}`).set('Authorization', `Bearer ${tokStudent}`);
    expect(ranks.status).toBe(200);
    expect(JSON.stringify(ranks.body)).toContain(d.body.id);
    // Instructors can't archive.
    expect((await http().post(`/v1/disciplines/${d.body.id}/unarchive`).set('Authorization', `Bearer ${tokInstructor}`)).status).toBe(403);

    const back = await owner.post(`/v1/disciplines/${d.body.id}/unarchive`);
    expect(back.status).toBe(201);
    expect(back.body.archivedAt).toBeNull();
    expect((await owner.post(`/v1/students/${studentId}/ranks/${d.body.id}/promote`).send({ acknowledgeWithoutSkillSignoff: true })).status).toBe(201);
  });

  it('skills keep the owner\'s order and show their lesson count (Decision 309)', async () => {
    const d = await newStyle({ name: 'Skills Order' });
    const ids: string[] = [];
    for (const name of ['Zeta', 'Alpha', 'Mid']) ids.push((await owner.post(`/v1/styles/${d.body.id}/skills`).send({ name })).body.id);
    let list = await owner.get(`/v1/styles/${d.body.id}/skills`);
    expect(list.body.items.map((x: { name: string }) => x.name)).toEqual(['Zeta', 'Alpha', 'Mid']);
    expect(list.body.items[0].lessonCount).toBe(0);

    const reordered = await owner.put(`/v1/styles/${d.body.id}/skills/order`).send({ skillIds: [ids[1], ids[2], ids[0]] });
    expect(reordered.status).toBe(200);
    list = await owner.get(`/v1/styles/${d.body.id}/skills`);
    expect(list.body.items.map((x: { name: string }) => x.name)).toEqual(['Alpha', 'Mid', 'Zeta']);
    expect((await owner.put(`/v1/styles/${d.body.id}/skills/order`).send({ skillIds: [ids[0]] })).status).toBe(400);
    expect((await http().put(`/v1/styles/${d.body.id}/skills/order`).set('Authorization', `Bearer ${tokInstructor}`).send({ skillIds: ids })).status).toBe(403);
    // Instructors can read the catalog (Decision 309: read-only Disciplines page for coaches).
    expect((await http().get(`/v1/styles/${d.body.id}/skills`).set('Authorization', `Bearer ${tokInstructor}`)).status).toBe(200);
    expect((await http().get(`/v1/styles/${d.body.id}/ranks`).set('Authorization', `Bearer ${tokInstructor}`)).status).toBe(200);
  });

  it('archived styles: refused on new plans and new coach permissions, kept where already set (Decision 310)', async () => {
    const d = await newStyle({ name: 'Old Style' });
    const kept = await owner.post(`/v1/schools/${school.id}/membership-plans`).send({ type: 'SUBSCRIPTION', title: 'Old plan', price: 1000, disciplineIds: [d.body.id] });
    expect(kept.status).toBe(201);
    const toggles = { canPromote: true, canDowngrade: false, canSignOffSkills: false, canAdjustProgress: false, canVerifyRanks: false, canVoidHistory: false, canChangeBoardThresholds: false };
    const grant = await owner.put(`/v1/schools/${school.id}/grading-permissions/${instructorUserId}`).send({ styles: [{ disciplineId: d.body.id, ...toggles }] });
    expect(grant.status).toBe(200);
    expect((await owner.post(`/v1/disciplines/${d.body.id}/archive`)).status).toBe(201);

    const plan = await owner.post(`/v1/schools/${school.id}/membership-plans`).send({ type: 'SUBSCRIPTION', title: 'New plan', price: 1000, disciplineIds: [d.body.id] });
    expect(plan.status).toBe(400);
    expect(plan.body.error.message).toContain('"Old Style" is archived, so it can\'t be picked.');
    // A plan that already had it can still be saved.
    expect((await owner.patch(`/v1/membership-plans/${kept.body.id}`).send({ title: 'Old plan renamed', disciplineIds: [d.body.id] })).status).toBe(200);
    // The same for coach permissions.
    expect((await owner.put(`/v1/schools/${school.id}/grading-permissions/${instructorUserId}`).send({ styles: [{ disciplineId: d.body.id, ...toggles }] })).status).toBe(200);
    // Once removed, it can't be given again while archived.
    expect((await owner.put(`/v1/schools/${school.id}/grading-permissions/${instructorUserId}`).send({ styles: [] })).status).toBe(200);
    const refused = await owner.put(`/v1/schools/${school.id}/grading-permissions/${instructorUserId}`).send({ styles: [{ disciplineId: d.body.id, ...toggles }] });
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toContain('archived');
    await owner.post(`/v1/disciplines/${d.body.id}/unarchive`);
  });

  it('students who left the School are not counted, and are marked on the ladder (Decision 310)', async () => {
    const d = await newStyle({ name: 'Counted' });
    const white = await owner.post(`/v1/styles/${d.body.id}/ranks`).send({
      order: 0,
      name: 'White',
      primaryColour: '#FFFFFF',
      stripeTiers: [
        { order: 0, count: 0, colour: '#FFFFFF', classesRequired: 1 },
        { order: 1, count: 1, colour: '#FFFFFF', classesRequired: 1 },
      ],
    });
    const leaver = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `${tag}-leaver@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Leaver',
        surname: 'Review',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: leaver.id, schoolId: school.id, revokedAt: new Date() } });
    const rung = white.body.stripeTiers.find((t: { order: number }) => t.order === 0).id;
    for (const id of [studentId, leaver.id]) {
      await superuser.studentRank.create({ data: { id: randomUUID(), studentId: id, disciplineId: d.body.id, schoolId: school.id, currentRankId: white.body.id, currentStripeId: rung } });
    }
    expect((await owner.get(`/v1/disciplines/${d.body.id}`)).body.studentCount).toBe(1);
    const list = await owner.get(`/v1/schools/${school.id}/disciplines`);
    expect(list.body.items.find((x: { id: string }) => x.id === d.body.id).studentCount).toBe(1);
    const holders = await owner.get(`/v1/styles/${d.body.id}/rung-holders`);
    expect(holders.status).toBe(200);
    const enrolled = Object.fromEntries(holders.body.items[0].students.map((s: { studentId: string; enrolled: boolean }) => [s.studentId, s.enrolled]));
    expect(enrolled).toEqual({ [studentId]: true, [leaver.id]: false });
    // Their rank still holds the rung: it can't be removed, and the reason
    // names them only as a former student (their account is no longer visible).
    const kept = white.body.stripeTiers.find((t: { order: number }) => t.order === 1);
    const removal = await owner.patch(`/v1/ranks/${white.body.id}`).send({ stripeTiers: [{ id: kept.id, order: 0, count: 1, colour: '#FFFFFF', name: kept.name }] });
    expect(removal.status).toBe(409);
    expect(removal.body.error.message).toContain('student Review, a former student');
  });

  it('the student app shows an archived style as archived, with no skills to work toward (Decision 310)', async () => {
    const d = await newStyle({ name: 'Retired' });
    const white = await newBelt(d.body.id, 0, 'White');
    await newBelt(d.body.id, 1, 'Yellow');
    await owner.post(`/v1/styles/${d.body.id}/skills`).send({ name: 'Bow' });
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId, disciplineId: d.body.id, schoolId: school.id, currentRankId: white.body.id, currentStripeId: white.body.stripeTiers[0].id },
    });
    const view = () => http().get(`/v1/students/${studentId}/grading`).set('Authorization', `Bearer ${tokStudent}`);
    const before = (await view()).body.items.find((x: { disciplineId: string }) => x.disciplineId === d.body.id);
    expect(before.archived).toBe(false);
    expect((await owner.post(`/v1/disciplines/${d.body.id}/archive`)).status).toBe(201);
    const res = await view();
    expect(res.status).toBe(200);
    const after = res.body.items.find((x: { disciplineId: string }) => x.disciplineId === d.body.id);
    expect(after).toMatchObject({ archived: true, disciplineName: 'Retired', skills: [] });
  });
});
