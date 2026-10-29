import { randomInt } from 'crypto';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';

/** A random code of `digits` digits (leading zeros kept). Staff kiosk codes
 * (Decision 320) and members' personal codes (Decision 315) use it. */
export function randomCheckInCode(digits: number): string {
  return String(randomInt(0, 10 ** digits)).padStart(digits, '0');
}

/** How long new codes are at this School (School.checkInCodeDigits, 4 or 6). */
export async function checkInCodeDigits(prismaJobs: PrismaJobsService, schoolId: string): Promise<number> {
  const school = await prismaJobs.school.findUnique({ where: { id: schoolId }, select: { checkInCodeDigits: true } });
  return school?.checkInCodeDigits === 6 ? 6 : 4;
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
