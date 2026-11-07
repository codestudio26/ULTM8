import { ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ageOn, AGE_OF_MAJORITY_YEARS, LATEST_TIME_ZONE } from './decorators/is-birth-date.decorator';
import { schoolZone } from './school-zone';
import { signedUpThemselves } from '../legal/legal-acceptance';

type Reader = Pick<PrismaClient, 'user' | 'school' | 'branch' | 'legalAcceptance'>;

export type SelfAttestedAction = 'waiver' | 'purchase';

const MESSAGES: Record<SelfAttestedAction, { noBirthDate: string; under18: string }> = {
  waiver: {
    noBirthDate: 'Add your date of birth to your profile before signing a waiver.',
    under18: "You're under 18, so a parent or guardian needs to sign this waiver for you from their Guardian account.",
  },
  purchase: {
    noBirthDate: 'Add your date of birth to your profile before buying a plan.',
    under18: "You're under 18, so a parent or guardian needs to buy this for you from their Guardian account.",
  },
};

/**
 * SKILL.md §13 / Decision 67 [CONFIRMED]: whether someone acting for
 * themselves is a self-attested adult by date of birth is checked at the
 * first consequential action — a Membership purchase, a booking-triggered
 * payment, or waiver-signing — and the action is blocked otherwise, pointing
 * to a Guardian. Shared by WaiversService.sign() and, since Decision 430
 * item 5 (FAM-5), MembershipsService.purchase()'s own (not a Guardian's)
 * path. An unknown date of birth is refused, as an under-18 one is. The 18th
 * birthday is counted on the School's own date (Decision 430 item 10), or,
 * for someone who signed up themselves, from the moment sign-up counts it
 * (the earliest time zone, Decision 444 item 6; Decision 446 item 8), so an
 * account made on its 18th birthday can sign and buy at once. People the
 * School or a parent created keep the School's date.
 *
 * `childMayAct` lets the waiver path keep Decision 318 item 8 (a School that
 * lets children of an age sign their own waivers). `db` is a connection that
 * can read the caller's own User row and the School's time zone (the caller's
 * own tenant context does).
 */
export async function assertSelfAttestedAdult(
  db: Reader,
  callerId: string,
  schoolId: string,
  action: SelfAttestedAction,
  childMayAct?: (dateOfBirth: Date, zone: string | null) => Promise<boolean>,
): Promise<void> {
  // The waiver's own (already translated) messages stay plain; a purchase's
  // carry a code the apps word themselves.
  const refuse = (code: 'BIRTH_DATE_NEEDED' | 'UNDER_18_SELF', message: string) =>
    new ForbiddenException(action === 'waiver' ? message : { code, message });
  const me = await db.user.findUniqueOrThrow({ where: { id: callerId }, select: { dateOfBirth: true } });
  if (!me.dateOfBirth) throw refuse('BIRTH_DATE_NEEDED', MESSAGES[action].noBirthDate);
  const zone = await schoolZone(db, schoolId);
  const now = new Date();
  if (ageOn(me.dateOfBirth, now, zone) >= AGE_OF_MAJORITY_YEARS) return;
  if (ageOn(me.dateOfBirth, now, LATEST_TIME_ZONE) >= AGE_OF_MAJORITY_YEARS && (await signedUpThemselves(db, callerId))) return;
  if (childMayAct && (await childMayAct(me.dateOfBirth, zone))) return;
  throw refuse('UNDER_18_SELF', MESSAGES[action].under18);
}
