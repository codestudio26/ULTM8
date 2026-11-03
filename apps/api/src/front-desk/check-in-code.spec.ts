import { enforceLargeSchoolCodes } from './check-in-code';
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
