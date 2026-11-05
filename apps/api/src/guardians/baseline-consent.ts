import { ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { isAdultOn } from '../common/decorators/is-birth-date.decorator';

type Reader = Pick<PrismaClient, 'guardianLink' | 'consentRecord' | 'user'>;

/**
 * Decision 430 item 9 (FAM-9): BASELINE consent (SKILL.md §14 — the tier
 * "every Guardian-linked minor account requires") for a Guardian-linked child.
 *
 * - NOT_NEEDED: no active parent link, or the person is 18 or over.
 * - GIVEN: at least one active parent has an Active BASELINE record.
 * - GRANDFATHERED: the child's parent link predates the rule (migration
 *   20270220000000) and nobody has withdrawn consent since; not blocked, and
 *   the parent is asked for consent in the app.
 * - WITHDRAWN: a parent withdrew it and nobody has given it again; booking,
 *   check-in and re-enrolling all wait for fresh consent.
 * - PENDING: never given.
 *
 * Either parent's consent counts for the child (Decision 430 item 9). Read on
 * the jobs connection (ConsentRecord and GuardianLink are each Guardian's own
 * rows under RLS), after the caller's own access checks.
 */
export type BaselineConsentState = 'NOT_NEEDED' | 'GIVEN' | 'GRANDFATHERED' | 'WITHDRAWN' | 'PENDING';

export async function baselineConsentState(db: Reader, studentId: string, zone?: string | null, now: Date = new Date()): Promise<BaselineConsentState> {
  const links = await db.guardianLink.findMany({
    where: { studentId, revokedAt: null },
    select: { guardianId: true, consentGrandfathered: true },
  });
  if (links.length === 0) return 'NOT_NEEDED';
  const student = await db.user.findUnique({ where: { id: studentId }, select: { dateOfBirth: true } });
  if (isAdultOn(student?.dateOfBirth, now, zone)) return 'NOT_NEEDED';
  const records = await db.consentRecord.findMany({
    where: { studentId, tier: 'BASELINE', guardianId: { in: links.map((l) => l.guardianId) } },
    select: { status: true },
  });
  if (records.some((r) => r.status === 'ACTIVE')) return 'GIVEN';
  if (records.some((r) => r.status === 'WITHDRAWN')) return 'WITHDRAWN';
  if (links.some((l) => l.consentGrandfathered)) return 'GRANDFATHERED';
  return 'PENDING';
}

/** Booking and check-in (Decision 430 item 9): refused while the child's
 * consent is pending or withdrawn, whoever asks (the parent, staff, the
 * tablet). */
export async function assertBaselineConsentGiven(db: Reader, studentId: string, zone?: string | null): Promise<void> {
  const state = await baselineConsentState(db, studentId, zone);
  if (state === 'PENDING' || state === 'WITHDRAWN') {
    throw new ForbiddenException({
      code: 'CONSENT_PENDING',
      message: "This child's parent or guardian hasn't given consent yet. They can give it in the ULTM8 app; until then the child can't book or check in.",
    });
  }
}

/** Enrolling (Decision 430 item 9): after a parent withdrew BASELINE consent,
 * the child is enrolled again only once a parent gives fresh consent. A child
 * whose consent was simply never given can still be enrolled (the School's
 * own Add a child does that before the parent signs in); booking waits. */
export async function assertNotConsentWithdrawn(db: Reader, studentId: string, zone?: string | null): Promise<void> {
  if ((await baselineConsentState(db, studentId, zone)) === 'WITHDRAWN') {
    throw new ForbiddenException({
      code: 'CONSENT_WITHDRAWN',
      message: "A parent or guardian withdrew consent for this child. A parent must give consent again in the ULTM8 app before the child can be enrolled.",
    });
  }
}
