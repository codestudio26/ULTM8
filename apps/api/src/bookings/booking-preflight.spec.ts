import { ForbiddenException } from '@nestjs/common';
import type { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import * as consent from '../guardians/baseline-consent';
import { bookingPreflight } from './booking-preflight';

/** Stress test round 6, R-2: the checks before a booking's transaction in one
 * read, with the same rules and the same order of answers. */
describe('bookingPreflight', () => {
  const row = (over: object = {}) => ({
    schoolTimezone: 'Europe/London',
    branchTimezone: null,
    requireWaiver: true,
    archivedSignaturesCount: false,
    hasWaiverInUse: true,
    hasGuardianLink: false,
    deletionRequestedAt: null,
    erasedAt: null,
    ...over,
  });
  const jobs = (r: object, consent: { links?: object[]; records?: object[]; dateOfBirth?: Date } = {}) => {
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([r]),
      guardianLink: { findMany: jest.fn().mockResolvedValue(consent.links ?? []) },
      user: { findUnique: jest.fn().mockResolvedValue({ dateOfBirth: consent.dateOfBirth ?? new Date('2016-05-01') }) },
      consentRecord: { findMany: jest.fn().mockResolvedValue(consent.records ?? []) },
    };
    return { db, prismaJobs: db as unknown as PrismaJobsService };
  };
  const refusal = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      return ((err as ForbiddenException).getResponse() as { code: string }).code;
    }
    throw new Error('expected a refusal');
  };

  it('an adult with no parent link: one statement, and the School rule and time zone for the transaction', async () => {
    const { db, prismaJobs } = jobs(row());
    expect(await bookingPreflight(prismaJobs, 'student', 'school', 'branch')).toEqual({
      schoolTimezone: 'Europe/London',
      waiverRule: { requireWaiver: true, archivedSignaturesCount: false, hasWaiverInUse: true },
    });
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(db.guardianLink.findMany).not.toHaveBeenCalled();
    expect(db.consentRecord.findMany).not.toHaveBeenCalled();
  });

  it("a child whose parent hasn't given BASELINE consent is refused (Decision 430 item 9)", async () => {
    const { prismaJobs } = jobs(row({ hasGuardianLink: true }), { links: [{ guardianId: 'parent', consentGrandfathered: false }] });
    expect(await refusal(bookingPreflight(prismaJobs, 'kid', 'school', null))).toBe('CONSENT_PENDING');
  });

  it("a child with a parent's consent passes; the 18th birthday is counted in the Branch's zone, else the School's", async () => {
    const spy = jest.spyOn(consent, 'assertBaselineConsentGiven');
    const linked = { links: [{ guardianId: 'parent', consentGrandfathered: false }], records: [{ status: 'ACTIVE' }] };
    await bookingPreflight(jobs(row({ hasGuardianLink: true, branchTimezone: 'Asia/Tokyo' }), linked).prismaJobs, 'kid', 'school', 'branch');
    await bookingPreflight(jobs(row({ hasGuardianLink: true }), linked).prismaJobs, 'kid', 'school', null);
    expect(spy.mock.calls.map((c) => c[2])).toEqual(['Asia/Tokyo', 'Europe/London']);
    spy.mockRestore();
  });

  it('an account being deleted is locked (ACCOUNT_CLOSING), after the consent check', async () => {
    const closing = jobs(row({ deletionRequestedAt: new Date() }));
    expect(await refusal(bookingPreflight(closing.prismaJobs, 'student', 'school', null))).toBe('ACCOUNT_CLOSING');
    const erased = jobs(row({ erasedAt: new Date() }));
    expect(await refusal(bookingPreflight(erased.prismaJobs, 'student', 'school', null))).toBe('ACCOUNT_CLOSING');
    const both = jobs(row({ hasGuardianLink: true, deletionRequestedAt: new Date() }), { links: [{ guardianId: 'parent', consentGrandfathered: false }] });
    expect(await refusal(bookingPreflight(both.prismaJobs, 'kid', 'school', null))).toBe('CONSENT_PENDING');
  });

  it('a School with no row: no School waiver rule, as the separate reads answered', async () => {
    const { prismaJobs } = jobs(row({ schoolTimezone: null, requireWaiver: null, archivedSignaturesCount: null, hasWaiverInUse: false }));
    expect(await bookingPreflight(prismaJobs, 'student', 'missing', null)).toEqual({
      schoolTimezone: null,
      waiverRule: { requireWaiver: false, archivedSignaturesCount: true, hasWaiverInUse: false },
    });
  });
});
