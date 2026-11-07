import { BadRequestException, Logger } from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';

/** Above this many current Students, a School's codes have 6 digits
 * (Decision 417): at 782 members, 1 in 10 random 4-digit guesses was someone's. */
export const LARGE_SCHOOL_STUDENTS = 500;

const logger = new Logger('CheckInCodes');

/** A random code of `digits` digits (leading zeros kept). Staff kiosk codes
 * (Decision 320) and members' personal codes (Decision 315) use it. */
export function randomCheckInCode(digits: number): string {
  return String(randomInt(0, 10 ** digits)).padStart(digits, '0');
}

/** How long new codes are at this School (School.checkInCodeDigits, 4 or 6).
 * A School that has grown past LARGE_SCHOOL_STUDENTS is moved to 6 first. */
export async function checkInCodeDigits(prismaJobs: PrismaJobsService, schoolId: string): Promise<number> {
  const school = await prismaJobs.school.findUnique({ where: { id: schoolId }, select: { checkInCodeDigits: true } });
  if (!school) return 4;
  const digits = school.checkInCodeDigits === 6 ? 6 : 4;
  // A small School keeps its own choice, and codes already given out keep their length.
  if ((await currentStudentCount(prismaJobs, schoolId)) <= LARGE_SCHOOL_STUDENTS) return digits;
  await enforceLargeSchoolCodes(prismaJobs, schoolId);
  return 6;
}

/**
 * The length a School's codes have, as a settings page reads it (stress test
 * round 6, R-1; Decision 447 item 2): a School that has passed
 * LARGE_SCHOOL_STUDENTS is moved to 6 digits now (Decision 417), instead of
 * only when a code is next given out or by the 15-minute sweep, so the page
 * never shows a 4 that saving would refuse. `stored` is the School's
 * checkInCodeDigits as the caller read it.
 */
export async function checkInCodeDigitsAsRead(prismaJobs: PrismaJobsService, schoolId: string, stored: number): Promise<number> {
  if (stored === 6) return 6;
  if ((await currentStudentCount(prismaJobs, schoolId)) <= LARGE_SCHOOL_STUDENTS) return 4;
  await enforceLargeSchoolCodes(prismaJobs, schoolId);
  return 6;
}

/**
 * The code length a settings save keeps (Decision 417; stress test round 6,
 * R-1, Decision 447 item 2): `digits` as sent, or undefined when not sent. A
 * School with more than LARGE_SCHOOL_STUDENTS current Students keeps 6:
 * - already on 6, a 4 is refused (CHECK_IN_CODE_DIGITS_LOCKED): it can't go
 *   back to 4 while it is large;
 * - still on 4 (it passed 500 since the page was read, before the sweep moved
 *   it), the 4 the page showed is not a change, so it is not refused: the
 *   School is moved to 6 now and the save keeps 6.
 */
export async function codeDigitsToSave(prismaJobs: PrismaJobsService, schoolId: string, digits: number | undefined): Promise<number | undefined> {
  if (digits === undefined || digits === 6) return digits;
  if ((await currentStudentCount(prismaJobs, schoolId)) <= LARGE_SCHOOL_STUDENTS) return digits;
  const school = await prismaJobs.school.findUnique({ where: { id: schoolId }, select: { checkInCodeDigits: true } });
  if (school?.checkInCodeDigits === 6) {
    throw new BadRequestException({
      code: 'CHECK_IN_CODE_DIGITS_LOCKED',
      message: `This School has more than ${LARGE_SCHOOL_STUDENTS} members, so its check-in codes have 6 digits.`,
    });
  }
  await enforceLargeSchoolCodes(prismaJobs, schoolId);
  return 6;
}

/** Current Students of the School, every Branch together. */
export async function currentStudentCount(prismaJobs: PrismaJobsService, schoolId: string): Promise<number> {
  const [row] = await prismaJobs.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(DISTINCT "userId") AS n FROM "RoleGrant"
    WHERE "schoolId" = ${schoolId} AND "role" = 'STUDENT' AND "revokedAt" IS NULL`;
  return Number(row?.n ?? 0);
}

/** Schools with more than LARGE_SCHOOL_STUDENTS current Students. */
export async function largeSchoolIds(prismaJobs: PrismaJobsService): Promise<string[]> {
  const rows = await prismaJobs.$queryRaw<Array<{ schoolId: string }>>`
    SELECT "schoolId" FROM "RoleGrant"
    WHERE "role" = 'STUDENT' AND "revokedAt" IS NULL AND "schoolId" IS NOT NULL
    GROUP BY "schoolId"
    HAVING COUNT(DISTINCT "userId") > ${LARGE_SCHOOL_STUDENTS}`;
  return rows.map((r) => r.schoolId);
}

/**
 * A large School (Decision 417): 6-digit codes, and every shorter member or
 * staff code replaced by a new 6-digit one, so the old ones stop working.
 * Safe to run again: it only touches codes still shorter than 6. A code made
 * at 4 digits by a request that started just before the switch is caught by
 * the next run (the sweep, or the next code given out here).
 */
export async function enforceLargeSchoolCodes(prismaJobs: PrismaJobsService, schoolId: string): Promise<{ replaced: number }> {
  const replaced = await prismaJobs.$transaction(async (tx) => {
    // One switch at a time per School: two at once would each pick new codes.
    await tx.$queryRaw`SELECT "id" FROM "School" WHERE "id" = ${schoolId} FOR UPDATE`;
    await tx.school.updateMany({ where: { id: schoolId, checkInCodeDigits: { not: 6 } }, data: { checkInCodeDigits: 6 } });
    const [students, staff] = await Promise.all([
      tx.$queryRaw<Array<{ id: string; code: string }>>`SELECT "id", "code" FROM "StudentCheckInCode" WHERE "schoolId" = ${schoolId}`,
      tx.$queryRaw<Array<{ id: string; code: string }>>`SELECT "id", "code" FROM "StaffKioskCode" WHERE "schoolId" = ${schoolId}`,
    ]);
    // One set of taken codes for both tables, so the switch never gives a
    // member and a staff member the same new code.
    const taken = new Set([...students, ...staff].map((r) => r.code));
    const freshStudent = freshCodes(students, taken);
    const freshStaff = freshCodes(staff, taken);
    if (freshStudent.size > 0) {
      await tx.$executeRaw`
        UPDATE "StudentCheckInCode" AS c SET "code" = v."code", "updatedAt" = now()
        FROM unnest(${[...freshStudent.keys()]}::text[], ${[...freshStudent.values()]}::text[]) AS v("id", "code")
        WHERE c."id" = v."id"`;
    }
    if (freshStaff.size > 0) {
      await tx.$executeRaw`
        UPDATE "StaffKioskCode" AS c SET "code" = v."code", "updatedAt" = now()
        FROM unnest(${[...freshStaff.keys()]}::text[], ${[...freshStaff.values()]}::text[]) AS v("id", "code")
        WHERE c."id" = v."id"`;
    }
    return freshStudent.size + freshStaff.size;
  });
  if (replaced > 0) logger.log(`School ${schoolId} has over ${LARGE_SCHOOL_STUDENTS} Students: ${replaced} check-in code(s) replaced with 6-digit ones`);
  return { replaced };
}

/** New 6-digit codes for the rows whose code is shorter, unlike every code
 * in `taken` (the School's member and staff codes, and the ones picked so
 * far, which are added to it), so no update in between collides. */
function freshCodes(rows: Array<{ id: string; code: string }>, taken: Set<string>): Map<string, string> {
  const fresh = new Map<string, string>();
  for (const row of rows) {
    if (row.code.length >= 6) continue;
    let code = randomCheckInCode(6);
    while (taken.has(code)) code = randomCheckInCode(6);
    taken.add(code);
    fresh.set(row.id, code);
  }
  return fresh;
}

/** Tries `write` with fresh codes until one isn't taken in the School. */
export async function withUniqueCode(digits: number, write: (code: string) => Promise<unknown>): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomCheckInCode(digits);
    try {
      await write(code);
      return code;
    } catch (err) {
      if ((err as { code?: string })?.code !== 'P2002') throw err;
    }
  }
  throw new Error('Could not issue a unique check-in code');
}
