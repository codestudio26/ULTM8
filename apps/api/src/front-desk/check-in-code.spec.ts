import { checkInCodeDigitsAsRead, codeDigitsToSave, enforceLargeSchoolCodes } from './check-in-code';
import type { PrismaJobsService } from '../common/prisma/prisma-jobs.service';

// The random codes, in the order they are drawn: the second would repeat the
// first, so it must be drawn again.
const mockDraws = [123456, 123456, 654321];
jest.mock('crypto', () => ({ ...jest.requireActual('crypto'), randomInt: () => mockDraws.shift() }));

describe('enforceLargeSchoolCodes (Decision 417)', () => {
  it('never gives a member and a staff member the same new 6-digit code', async () => {
    const updates: unknown[][] = [];
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([]) // the School row lock
        .mockResolvedValueOnce([{ id: 'student-1', code: '0001' }])
        .mockResolvedValueOnce([{ id: 'staff-1', code: '9999' }]),
      school: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $executeRaw: jest.fn((_sql: TemplateStringsArray, ...values: unknown[]) => {
        updates.push(values);
        return Promise.resolve(1);
      }),
    };
    const prismaJobs = { $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as PrismaJobsService;

    expect(await enforceLargeSchoolCodes(prismaJobs, 'school-1')).toEqual({ replaced: 2 });
    expect(updates).toEqual([
      [['student-1'], ['123456']],
      [['staff-1'], ['654321']],
    ]);
  });
});

/** Stress test round 6, R-1 (Decision 447 item 2): the page never shows a
 * length that saving refuses. */
describe('check-in code length as read and as saved (Decision 417)', () => {
  const school = (students: number, stored: number) => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      school: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $executeRaw: jest.fn(),
    };
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([{ n: BigInt(students) }]),
      school: { findUnique: jest.fn().mockResolvedValue({ checkInCodeDigits: stored }) },
      $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    return { db, tx, prismaJobs: db as unknown as PrismaJobsService };
  };

  it('a School past 500 Students still on 4 reads 6, and is moved to 6 there and then', async () => {
    const big = school(501, 4);
    expect(await checkInCodeDigitsAsRead(big.prismaJobs, 's', 4)).toBe(6);
    expect(big.tx.school.updateMany).toHaveBeenCalledWith({ where: { id: 's', checkInCodeDigits: { not: 6 } }, data: { checkInCodeDigits: 6 } });
    const small = school(500, 4);
    expect(await checkInCodeDigitsAsRead(small.prismaJobs, 's', 4)).toBe(4);
    expect(small.db.$transaction).not.toHaveBeenCalled();
    const six = school(10, 6);
    expect(await checkInCodeDigitsAsRead(six.prismaJobs, 's', 6)).toBe(6);
    expect(six.db.$queryRaw).not.toHaveBeenCalled();
  });

  it('saving the 4 a page read before the School passed 500 is not refused: it keeps 6', async () => {
    const big = school(501, 4);
    expect(await codeDigitsToSave(big.prismaJobs, 's', 4)).toBe(6);
    expect(big.db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('a large School already on 6 still refuses going back to 4 (CHECK_IN_CODE_DIGITS_LOCKED)', async () => {
    await expect(codeDigitsToSave(school(501, 6).prismaJobs, 's', 4)).rejects.toMatchObject({ response: { code: 'CHECK_IN_CODE_DIGITS_LOCKED' } });
  });

  it('a small School keeps its own choice; 6 and an unsent value are saved as sent', async () => {
    expect(await codeDigitsToSave(school(500, 6).prismaJobs, 's', 4)).toBe(4);
    expect(await codeDigitsToSave(school(900, 4).prismaJobs, 's', 6)).toBe(6);
    expect(await codeDigitsToSave(school(900, 4).prismaJobs, 's', undefined)).toBeUndefined();
  });
});
