/**
 * Decision 134/141 groundwork — GradingErasureService.eraseGradingDataForDeletedAccount(),
 * the grading-specific slice of account deletion (Spec 55 Decision 44). No
 * endpoint or scheduler calls this yet (see GradingErasureService's own
 * header comment) — this test calls it directly, same approach
 * entity-offboarding-purge.e2e-spec.ts already established for a job with no
 * HTTP surface of its own.
 *
 * Requires DATABASE_URL, DATABASE_URL_JOBS. Skips with a warning if either
 * is unset, same convention as every other job spec here.
 */
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { GradingErasureService } from '../src/ranks/grading-erasure.service';
import { PrismaGradingErasureService } from '../src/common/prisma/prisma-grading-erasure.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_GRADING_ERASURE = process.env.DATABASE_URL_GRADING_ERASURE;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_GRADING_ERASURE);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[grading-erasure.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_GRADING_ERASURE not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('GradingErasureService — Decision 134 groundwork', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  let service: GradingErasureService;

  let school: { id: string };
  let discipline: { id: string };
  let skill: { id: string };
  let rank: { id: string };
  const userIds: string[] = [];
  const studentRankIds: string[] = [];

  const mkUser = async (label: string) =>
    superuser.user.create({
      data: {
        id: randomUUID(),
        email: `grading-erasure-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Erasure',
        surname: label,
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
      },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [GradingErasureService, PrismaGradingErasureService] }).compile();
    service = moduleRef.get(GradingErasureService);

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Grading Erasure Job School' } });
    discipline = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Erasure BJJ' } });
    skill = await superuser.skill.create({ data: { id: randomUUID(), disciplineId: discipline.id, schoolId: school.id, name: 'Erasure Skill' } });
    rank = await superuser.rank.create({
      data: { id: randomUUID(), disciplineId: discipline.id, schoolId: school.id, order: 0, name: 'Erasure White Belt', primaryColour: 'white' },
    });
  });

  afterAll(async () => {
    await superuser.studentRank.deleteMany({ where: { id: { in: studentRankIds } } });
    await superuser.rank.deleteMany({ where: { id: rank.id } });
    await superuser.skill.deleteMany({ where: { id: skill.id } });
    await superuser.discipline.deleteMany({ where: { id: discipline.id } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: school.id } });
    await superuser.$disconnect();
  });

  it('a Student with no grading data at all is a no-op, not an error', async () => {
    const student = await mkUser('no-data');
    userIds.push(student.id);
    await expect(service.eraseGradingDataForDeletedAccount(student.id)).resolves.toBeUndefined();
  });

  it(
    'hard-deletes StudentRank, StudentRankSkillStatus and PromotionEvent for the Student, across every discipline, ' +
      'cascading PromotionEventNoteLog and SkillSignOffLog along with their parents (Decision 134)',
    async () => {
      const student = await mkUser('full-history');
      const instructor = await mkUser('instructor-for-history');
      userIds.push(student.id, instructor.id);

      const studentRank = await superuser.studentRank.create({
        data: { id: randomUUID(), studentId: student.id, disciplineId: discipline.id, schoolId: school.id, currentRankId: rank.id },
      });
      studentRankIds.push(studentRank.id);

      const skillStatus = await superuser.studentRankSkillStatus.create({
        data: { id: randomUUID(), studentRankId: studentRank.id, schoolId: school.id, studentId: student.id, skillId: skill.id, status: 'LEARNING' },
      });

      const promotionEvent = await superuser.promotionEvent.create({
        data: {
          id: randomUUID(),
          studentRankId: studentRank.id,
          schoolId: school.id,
          studentId: student.id,
          type: 'PROMOTION',
          performedById: instructor.id,
          toRankId: rank.id,
        },
      });

      const signOffLog = await superuser.skillSignOffLog.create({
        data: {
          id: randomUUID(),
          studentRankId: studentRank.id,
          schoolId: school.id,
          studentId: student.id,
          skillId: skill.id,
          fromStatus: 'NOT_STARTED',
          toStatus: 'LEARNING',
          changedById: instructor.id,
        },
      });

      const noteLog = await superuser.promotionEventNoteLog.create({
        data: {
          id: randomUUID(),
          promotionEventId: promotionEvent.id,
          schoolId: school.id,
          studentId: student.id,
          change: 'EDITED',
          oldNote: null,
          newNote: 'Great first class',
          changedById: instructor.id,
        },
      });

      // A second discipline's own StudentRank must be caught too — not just
      // the first one found.
      const discipline2 = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Erasure BJJ — second style' } });
      const rank2 = await superuser.rank.create({
        data: { id: randomUUID(), disciplineId: discipline2.id, schoolId: school.id, order: 0, name: 'Erasure White Belt 2', primaryColour: 'white' },
      });
      const studentRank2 = await superuser.studentRank.create({
        data: { id: randomUUID(), studentId: student.id, disciplineId: discipline2.id, schoolId: school.id, currentRankId: rank2.id },
      });
      studentRankIds.push(studentRank2.id);

      await service.eraseGradingDataForDeletedAccount(student.id);

      expect(await superuser.studentRank.findUnique({ where: { id: studentRank.id } })).toBeNull();
      expect(await superuser.studentRank.findUnique({ where: { id: studentRank2.id } })).toBeNull();
      expect(await superuser.studentRankSkillStatus.findUnique({ where: { id: skillStatus.id } })).toBeNull();
      expect(await superuser.promotionEvent.findUnique({ where: { id: promotionEvent.id } })).toBeNull();
      // Cascaded, not explicitly deleted by the service.
      expect(await superuser.skillSignOffLog.findUnique({ where: { id: signOffLog.id } })).toBeNull();
      expect(await superuser.promotionEventNoteLog.findUnique({ where: { id: noteLog.id } })).toBeNull();

      // Nothing else at this School was touched.
      expect(await superuser.rank.findUnique({ where: { id: rank.id } })).not.toBeNull();
      expect(await superuser.discipline.findUnique({ where: { id: discipline.id } })).not.toBeNull();
      expect(await superuser.user.findUnique({ where: { id: instructor.id } })).not.toBeNull();

      await superuser.rank.delete({ where: { id: rank2.id } });
      await superuser.discipline.delete({ where: { id: discipline2.id } });
    },
  );

  it('does not touch another Student\'s grading data at the same School', async () => {
    const studentA = await mkUser('isolation-a');
    const studentB = await mkUser('isolation-b');
    userIds.push(studentA.id, studentB.id);

    const rankA = await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: studentA.id, disciplineId: discipline.id, schoolId: school.id, currentRankId: rank.id },
    });
    const rankB = await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: studentB.id, disciplineId: discipline.id, schoolId: school.id, currentRankId: rank.id },
    });
    studentRankIds.push(rankA.id, rankB.id);

    await service.eraseGradingDataForDeletedAccount(studentA.id);

    expect(await superuser.studentRank.findUnique({ where: { id: rankA.id } })).toBeNull();
    expect(await superuser.studentRank.findUnique({ where: { id: rankB.id } })).not.toBeNull();

    await superuser.studentRank.delete({ where: { id: rankB.id } });
  });
});
