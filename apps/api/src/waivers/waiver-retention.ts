/**
 * How long a signed waiver is kept (Decision 426, which builds Decision 423
 * item 8 and amends Decisions 269 and 354 W16). Pure functions only: the
 * daily purge (EntityOffboardingPurgeProcessor) reads each signature's inputs
 * in one query per batch and asks these functions what to do with it.
 *
 * The rule, one platform-wide default that a School cannot shorten:
 * - A signed waiver is kept while the person is a member of that School, and
 *   for 7 years after they leave. "Member" means a live STUDENT role at that
 *   School; leaving is that role's revokedAt (the latest one, if they joined
 *   more than once). A School closing its account counts as every member
 *   leaving on the day it closed (School.archivedAt).
 * - For a child it is kept until they turn 18 + 7 (age 25), if that is later.
 *   A child is someone under 18 on the day the waiver was signed, judged by
 *   the 18th birthday saved on the signature when it was signed
 *   (WaiverSignature.studentMajorityDate), whatever the method. With no date
 *   of birth on file, a waiver a Guardian signed for someone else counts as a
 *   child's, and is kept until a date of birth is added (never guessed).
 * - Someone who was never a member of that School: the 7 years (and the
 *   child's 25th birthday) count from the day they signed.
 * - A signature left on a merged-away duplicate record counts as a member's
 *   while either record is a member there.
 * - An unsigned or pending entry of someone who is no longer a member holds
 *   no signature and is removed.
 * - Guests (GuestWaiverSignature): 7 years after the class, and for a guest
 *   under 18 at the class not before they turn 25.
 *
 * Dates are UTC throughout. Adding years to 29 February lands on 1 March
 * (JavaScript's own rollover, and the migration's SQL for the stored 18th
 * birthday does the same), so a leap-day birthday is never treated as
 * reached a day early.
 *
 * Not legal advice: a privacy lawyer is to confirm these numbers for each
 * country ULTM8 launches in (Decision 423 item 8).
 */

/** The numbers one retention rule uses. */
export interface WaiverRetentionPolicy {
  /** Age at which a person is an adult (Decision 426 item 8: 18 everywhere for now). */
  ageOfMajorityYears: number;
  /** Years a signed waiver is kept after the person leaves (or, for a child, after they turn 18). */
  yearsKeptAfterLeaving: number;
}

/** The one platform-wide default (Decision 423 item 8). Schools cannot change it. */
export const PLATFORM_WAIVER_RETENTION_POLICY: Readonly<WaiverRetentionPolicy> = Object.freeze({
  ageOfMajorityYears: 18,
  yearsKeptAfterLeaving: 7,
});

/**
 * The policy for a School. Always the platform default today; a per-country
 * rule can be added here later (keyed on the School's country) without
 * touching the purge itself. Deliberately takes no School setting: a School
 * cannot shorten it.
 */
export function waiverRetentionPolicyFor(_school: { country?: string | null } = {}): WaiverRetentionPolicy {
  return PLATFORM_WAIVER_RETENTION_POLICY;
}

/** Why a signature was purged, as written to WaiverSignaturePurgeLog.rule. */
export type WaiverPurgeRule =
  | 'ADULT_LEFT'
  | 'CHILD_LEFT'
  | 'ADULT_NEVER_MEMBER'
  | 'CHILD_NEVER_MEMBER'
  | 'LEFT_UNSIGNED'
  | 'GUEST_ADULT'
  | 'GUEST_CHILD';

/** Why a signature is kept for now. */
export type WaiverKeepReason = 'MEMBER' | 'NOT_YET_DUE' | 'NEEDS_DATE_OF_BIRTH';

export type WaiverRetentionDecision =
  | { action: 'purge'; rule: WaiverPurgeRule; retainUntil: Date | null }
  | { action: 'keep'; reason: WaiverKeepReason; rule?: WaiverPurgeRule; retainUntil?: Date };

/** What the purge reads about one member's WaiverSignature. */
export interface MemberSignatureRetentionInput {
  status: 'SIGNED' | 'EXPIRED' | 'UNSIGNED' | 'PENDING';
  /** The Student whose waiver this is. */
  studentId: string;
  /** Who signed online (null for paper or not yet signed). */
  signedById: string | null;
  /** When it was signed (null on an unsigned entry). */
  signedDate: Date | null;
  /** When the row was made; used only if a signed row has no signedDate. */
  createdAt: Date;
  /** The Student's 18th birthday, saved on the signature when it was signed. */
  studentMajorityDate: Date | null;
  /** A live STUDENT role at this School, for the Student or the record they were merged into. */
  hasLiveStudentRole: boolean;
  /** Has either record ever held a STUDENT role at this School? */
  everMember: boolean;
  /** The latest revokedAt of those STUDENT roles at this School (null if none). */
  lastLeftAt: Date | null;
  /** When the School closed its account (School.archivedAt), else null. */
  schoolClosedAt: Date | null;
  /** True once the closed School is past its 90-day window (School.purgedAt set), so it can no longer be reopened. */
  schoolClosureFinal: boolean;
}

/** Adds whole years in UTC. 29 February plus a number of years that lands in
 * a common year becomes 1 March. */
export function addYearsUtc(date: Date, years: number): Date {
  const result = new Date(date.getTime());
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

function later(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

/**
 * Was the person a child when they signed? Judged by the saved 18th
 * birthday; with none on file, a waiver a Guardian signed for someone else
 * counts as a child's. `null` means "a child, but with no date of birth":
 * kept until one is added.
 */
export function signedAsChild(input: Pick<MemberSignatureRetentionInput, 'studentId' | 'signedById' | 'signedDate' | 'createdAt' | 'studentMajorityDate'>): boolean | null {
  const signedOn = input.signedDate ?? input.createdAt;
  if (input.studentMajorityDate) {
    return signedOn.getTime() < input.studentMajorityDate.getTime();
  }
  const guardianSigned = input.signedById !== null && input.signedById !== input.studentId;
  return guardianSigned ? null : false;
}

/** What to do with one member's WaiverSignature today. */
export function decideMemberSignatureRetention(
  input: MemberSignatureRetentionInput,
  now: Date,
  policy: WaiverRetentionPolicy = PLATFORM_WAIVER_RETENTION_POLICY,
): WaiverRetentionDecision {
  const signed = input.status === 'SIGNED' || input.status === 'EXPIRED';

  if (!signed) {
    // An unsigned or pending entry holds no signature: it goes once the
    // person is no longer a member there. A closed School's are removed only
    // once it can no longer be reopened, so a School reopened within its 90
    // days finds its entries as they were.
    const stillMember = input.hasLiveStudentRole && !input.schoolClosureFinal;
    return stillMember ? { action: 'keep', reason: 'MEMBER' } : { action: 'purge', rule: 'LEFT_UNSIGNED', retainUntil: null };
  }

  const isMemberNow = input.hasLiveStudentRole && input.schoolClosedAt === null;
  if (isMemberNow) return { action: 'keep', reason: 'MEMBER' };

  const child = signedAsChild(input);
  const signedOn = input.signedDate ?? input.createdAt;

  // When the person left. Still holding a role at a closed School: they left
  // on the day it closed. Never a member here: count from the signing day.
  let leftAt: Date | null;
  if (input.hasLiveStudentRole) leftAt = input.schoolClosedAt;
  else if (input.everMember) leftAt = input.lastLeftAt;
  else leftAt = null;
  const neverMember = leftAt === null;
  const clockStart = leftAt ?? signedOn;

  if (child === null) {
    return { action: 'keep', reason: 'NEEDS_DATE_OF_BIRTH', rule: neverMember ? 'CHILD_NEVER_MEMBER' : 'CHILD_LEFT' };
  }

  let retainUntil = addYearsUtc(clockStart, policy.yearsKeptAfterLeaving);
  let rule: WaiverPurgeRule;
  if (child) {
    // studentMajorityDate is set whenever child is true (see signedAsChild).
    retainUntil = later(retainUntil, addYearsUtc(input.studentMajorityDate as Date, policy.yearsKeptAfterLeaving));
    rule = neverMember ? 'CHILD_NEVER_MEMBER' : 'CHILD_LEFT';
  } else {
    rule = neverMember ? 'ADULT_NEVER_MEMBER' : 'ADULT_LEFT';
  }

  return retainUntil.getTime() <= now.getTime() ? { action: 'purge', rule, retainUntil } : { action: 'keep', reason: 'NOT_YET_DUE', rule, retainUntil };
}

/** What the purge reads about one GuestWaiverSignature. */
export interface GuestSignatureRetentionInput {
  classStartsAt: Date;
  /** A date (no time): midnight UTC. */
  guestDateOfBirth: Date;
}

/** A guest's signature: 7 years after the class, and for a guest under 18 at
 * the class not before they turn 18 + 7. */
export function decideGuestSignatureRetention(
  input: GuestSignatureRetentionInput,
  now: Date,
  policy: WaiverRetentionPolicy = PLATFORM_WAIVER_RETENTION_POLICY,
): WaiverRetentionDecision {
  const majority = addYearsUtc(input.guestDateOfBirth, policy.ageOfMajorityYears);
  const child = input.classStartsAt.getTime() < majority.getTime();
  let retainUntil = addYearsUtc(input.classStartsAt, policy.yearsKeptAfterLeaving);
  if (child) retainUntil = later(retainUntil, addYearsUtc(majority, policy.yearsKeptAfterLeaving));
  const rule: WaiverPurgeRule = child ? 'GUEST_CHILD' : 'GUEST_ADULT';
  return retainUntil.getTime() <= now.getTime() ? { action: 'purge', rule, retainUntil } : { action: 'keep', reason: 'NOT_YET_DUE', rule, retainUntil };
}
