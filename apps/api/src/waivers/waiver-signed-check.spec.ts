import { bookingWaiverRefusal, hasCountingWaiverSignature, readSchoolWaiverRule } from './waiver-signed-check';
import type { PrismaJobsService } from '../common/prisma/prisma-jobs.service';

type Tx = Parameters<typeof bookingWaiverRefusal>[0];

/** Decision 441 item 5 and Decision 354, with the School's rule read before the
 * booking's transaction (stress test round 6, R-2): only the signature is read
 * in it. */
describe('bookingWaiverRefusal', () => {
  const txWith = (signed: boolean) => {
    const tx = {
      school: { findUnique: jest.fn() },
      waiverSignature: { findFirst: jest.fn().mockResolvedValue(signed ? { id: 'sig' } : null) },
    };
    return { tx, client: tx as unknown as Tx };
  };
  const rule = (requireWaiver: boolean, hasWaiverInUse = true, archivedSignaturesCount = true) => ({ requireWaiver, hasWaiverInUse, archivedSignaturesCount });

  it('reads nothing when neither the School nor the Class asks for a waiver', async () => {
    const { tx, client } = txWith(false);
    expect(await bookingWaiverRefusal(client, 'st', 'sc', false, rule(false))).toBeNull();
    expect(tx.waiverSignature.findFirst).not.toHaveBeenCalled();
    expect(tx.school.findUnique).not.toHaveBeenCalled();
  });

  it("the School rule refuses without a signature only while the School has a waiver in use; the Class's own mark always", async () => {
    expect(await bookingWaiverRefusal(txWith(false).client, 'st', 'sc', false, rule(true))).toBe('school');
    expect(await bookingWaiverRefusal(txWith(false).client, 'st', 'sc', false, rule(true, false))).toBeNull();
    expect(await bookingWaiverRefusal(txWith(false).client, 'st', 'sc', true, rule(true, false))).toBe('class');
    expect(await bookingWaiverRefusal(txWith(false).client, 'st', 'sc', true, rule(false))).toBe('class');
    expect(await bookingWaiverRefusal(txWith(true).client, 'st', 'sc', true, rule(true))).toBeNull();
  });

  it("uses the rule's archived-signatures setting instead of reading the School again", async () => {
    const off = txWith(false);
    await bookingWaiverRefusal(off.client, 'st', 'sc', true, rule(true, true, false));
    expect(off.tx.school.findUnique).not.toHaveBeenCalled();
    expect(off.tx.waiverSignature.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ waiver: { archivedAt: null } }) }));
    const on = txWith(false);
    await bookingWaiverRefusal(on.client, 'st', 'sc', true, rule(true, true, true));
    expect(on.tx.waiverSignature.findFirst.mock.calls[0][0].where.waiver).toBeUndefined();
  });
});

describe('hasCountingWaiverSignature', () => {
  it('reads the School setting itself when not given, and a missing School adds no filter', async () => {
    const tx = { school: { findUnique: jest.fn().mockResolvedValue(null) }, waiverSignature: { findFirst: jest.fn().mockResolvedValue(null) } };
    expect(await hasCountingWaiverSignature(tx as unknown as Tx, 'st', 'sc')).toBe(false);
    expect(tx.school.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.waiverSignature.findFirst.mock.calls[0][0].where.waiver).toBeUndefined();
  });
});

describe('readSchoolWaiverRule', () => {
  it('one statement; a School with no row stops nobody', async () => {
    const prismaJobs = { $queryRaw: jest.fn().mockResolvedValueOnce([{ requireWaiver: true, archivedSignaturesCount: false, hasWaiverInUse: true }]).mockResolvedValueOnce([]) };
    expect(await readSchoolWaiverRule(prismaJobs as unknown as PrismaJobsService, 'sc')).toEqual({ requireWaiver: true, archivedSignaturesCount: false, hasWaiverInUse: true });
    expect(await readSchoolWaiverRule(prismaJobs as unknown as PrismaJobsService, 'gone')).toEqual({ requireWaiver: false, archivedSignaturesCount: true, hasWaiverInUse: false });
    expect(prismaJobs.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
