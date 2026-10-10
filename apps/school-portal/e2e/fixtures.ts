import { createHash, createHmac, randomBytes, randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import type { Page } from '@playwright/test';

/**
 * Test data for the portal's browser tests, written straight to the test
 * database as the superuser (the same approach as apps/api's e2e tests), and a
 * signed-in School owner. Each test seeds its own School so tests don't share
 * state; `cleanup()` removes everything this file created.
 */
export const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

const schoolIds: string[] = [];
const userIds: string[] = [];

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** An access token in the API's own shape (HS256 with JWT_ACCESS_SECRET). */
function signToken(payload: object): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET is not set');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify({ ...payload, iat: now, exp: now + 3600 }));
  const signature = base64url(createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${signature}`;
}

async function mkUser(firstName: string, surname: string) {
  const u = await db.user.create({
    data: {
      id: randomUUID(),
      email: `portal-e2e-${randomUUID()}@example.test`,
      phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
      firstName,
      surname,
      passcodeHash: 'x',
      dateOfBirth: new Date('2000-01-01'),
      phoneVerifiedAt: new Date(),
    },
  });
  userIds.push(u.id);
  return u;
}

export interface GradingSchool {
  schoolId: string;
  ownerId: string;
  ownerToken: string;
  disciplineId: string;
  rung: Record<string, { id: string; rankId: string }>;
  skillId: string;
  /** A student at White 1 with 3 classes: classes and days done, the Armbar skill
   * for White 2 not signed off yet. */
  student: { id: string; name: string };
  /** An enrolled student with no rank in the style. */
  newStudent: { id: string; name: string };
}

/**
 * A School with one style, BJJ: White 0 → White 1 → White 2 → Blue 0, each
 * needing 3 classes; White 2 also needs the Armbar skill, which has a lesson.
 */
export async function seedGradingSchool(): Promise<GradingSchool> {
  const school = await db.school.create({ data: { id: randomUUID(), name: `Portal E2E ${randomUUID().slice(0, 8)}`, ranksToggle: true } });
  schoolIds.push(school.id);
  const owner = await mkUser('Olive', 'Owner');
  await db.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });

  const bjj = await db.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ', classTypesOffered: [] } });
  const skill = await db.skill.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, name: 'Armbar' } });
  const rung: GradingSchool['rung'] = {};
  const belts: Array<[string, string, number, number]> = [
    ['White', '#FFFFFF', 0, 3],
    ['Blue', '#1E40AF', 1, 1],
  ];
  for (const [name, colour, order, tiers] of belts) {
    const rank = await db.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order, name, primaryColour: colour } });
    for (let t = 0; t < tiers; t++) {
      const tier = await db.rankStripeTier.create({
        data: {
          id: randomUUID(), rankId: rank.id, schoolId: school.id, order: t, count: t, colour: '#000000', name: `${name} ${t}`,
          stripeSegments: t > 0 ? [{ count: t, colour: '#FFFFFF' }] : [], classesRequired: 3,
        },
      });
      rung[`${name} ${t}`] = { id: tier.id, rankId: rank.id };
    }
  }
  await db.rankStripeTierRequiredSkill.create({ data: { stripeTierId: rung['White 2'].id, skillId: skill.id } });
  const lesson = await db.lesson.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Armbar from guard', format: 'PRERECORDED' } });
  await db.lessonSkill.create({ data: { lessonId: lesson.id, skillId: skill.id } });

  const enrol = async (first: string, last: string) => {
    const u = await mkUser(first, last);
    await db.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: u.id, schoolId: school.id } });
    return u;
  };
  const student = await enrol('Sam', 'Lee');
  await db.studentRank.create({
    data: {
      id: randomUUID(), studentId: student.id, disciplineId: bjj.id, schoolId: school.id,
      currentRankId: rung['White 1'].rankId, currentStripeId: rung['White 1'].id,
      classesAttendedTowardCheckpoint: 3, dateOfCurrentRank: new Date(Date.now() - 60 * 86_400_000),
    },
  });
  const newStudent = await enrol('Nia', 'Park');

  return {
    schoolId: school.id,
    ownerId: owner.id,
    ownerToken: signToken({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] }),
    disciplineId: bjj.id,
    rung,
    skillId: skill.id,
    student: { id: student.id, name: 'Sam Lee' },
    newStudent: { id: newStudent.id, name: 'Nia Park' },
  };
}

/** One more enrolled student in this School's BJJ, at a rung with a class count. */
export async function addStudent(
  s: GradingSchool,
  first: string,
  last: string,
  opts: { rung: string; classes?: number; activeOverride?: boolean | null },
) {
  const u = await mkUser(first, last);
  await db.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: u.id, schoolId: s.schoolId } });
  await db.studentRank.create({
    data: {
      id: randomUUID(), studentId: u.id, disciplineId: s.disciplineId, schoolId: s.schoolId,
      currentRankId: s.rung[opts.rung].rankId, currentStripeId: s.rung[opts.rung].id,
      classesAttendedTowardCheckpoint: opts.classes ?? 0, boardActiveOverride: opts.activeOverride ?? null,
      dateOfCurrentRank: new Date(Date.now() - 60 * 86_400_000),
    },
  });
  return { id: u.id, name: `${first} ${last}` };
}

/** An Instructor at this School (no branch), who can be given grading permission. */
export async function addCoach(s: GradingSchool, first: string, last: string) {
  const u = await mkUser(first, last);
  await db.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: u.id, schoolId: s.schoolId } });
  return { id: u.id, name: `${first} ${last}` };
}

/** Anyone with these grants (none: a plain account), signed in by `token`. */
export async function addPerson(
  first: string,
  last: string,
  grants: Array<{ role: 'STUDENT' | 'INSTRUCTOR' | 'BRANCH_STAFF'; schoolId: string; branchId?: string }> = [],
) {
  const u = await mkUser(first, last);
  for (const g of grants) {
    await db.roleGrant.create({ data: { id: randomUUID(), role: g.role, userId: u.id, schoolId: g.schoolId, branchId: g.branchId ?? null } });
  }
  const token = signToken({
    sub: u.id,
    email: u.email,
    grants: grants.map((g) => ({ role: g.role, franchiseId: null, schoolId: g.schoolId, branchId: g.branchId ?? null })),
  });
  return { id: u.id, email: u.email, name: `${first} ${last}`, token };
}

export async function addBranch(s: GradingSchool, name: string) {
  return db.branch.create({ data: { id: randomUUID(), schoolId: s.schoolId, name } });
}

/** A coach invite as the API makes it (Decision 183); returns the link's token. */
export async function addCoachInvite(s: GradingSchool, email: string, opts: { branchId?: string; expiresAt?: Date } = {}) {
  const token = randomBytes(32).toString('base64url');
  await db.coachInvite.create({
    data: {
      id: randomUUID(),
      schoolId: s.schoolId,
      branchId: opts.branchId ?? null,
      email: email.toLowerCase(),
      tokenHash: createHash('sha256').update(token).digest('hex'),
      invitedById: s.ownerId,
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 7 * 86_400_000),
    },
  });
  return token;
}

/** Signs the page in as this token's user (the portal keeps the token in sessionStorage). */
export async function signIn(page: Page, token: string) {
  await page.addInitScript((t) => sessionStorage.setItem('ultm8.accessToken', t), token);
}

export async function cleanup() {
  if (schoolIds.length === 0) return;
  const where = { schoolId: { in: schoolIds } };
  await db.notification.deleteMany({ where: { userId: { in: userIds } } });
  await db.skillSignOffLog.deleteMany({ where });
  await db.studentRankSkillStatus.deleteMany({ where });
  await db.gradingPermission.deleteMany({ where });
  await db.promotionEvent.deleteMany({ where });
  await db.studentRank.deleteMany({ where });
  await db.lessonSkill.deleteMany({ where: { lesson: { schoolId: { in: schoolIds } } } });
  await db.lesson.deleteMany({ where });
  await db.rankStripeTierRequiredSkill.deleteMany({ where: { skill: { schoolId: { in: schoolIds } } } });
  await db.rankRequiredSkill.deleteMany({ where: { skill: { schoolId: { in: schoolIds } } } });
  await db.rankStripeTier.deleteMany({ where });
  await db.rank.deleteMany({ where });
  await db.skill.deleteMany({ where });
  await db.discipline.deleteMany({ where });
  await db.coachInvite.deleteMany({ where });
  await db.staffPermission.deleteMany({ where });
  await db.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
  await db.roleGrant.deleteMany({ where });
  await db.branch.deleteMany({ where });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.school.deleteMany({ where: { id: { in: schoolIds } } });
  schoolIds.length = 0;
  userIds.length = 0;
  await db.$disconnect();
}
