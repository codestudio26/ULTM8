import { ApiError } from '@ultm8/api-client';
import { formatDateTime } from './formatDate';
import { translate } from '../i18n/I18nProvider';

/** Every screen in this app needs "show the real backend message if there is one,
 * otherwise a friendly fallback" — this was duplicated as the same
 * `err instanceof ApiError ? err.message : '<fallback>'` ternary at 12+ call sites
 * (auth screens, academies, bookings) before being extracted here on review.
 *
 * Booking and check-in errors the API marks with a code (Decision 322) get this
 * app's own wording: their API text names endpoints and fields. */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  return codedMessage(err) ?? err.message;
}

function codedMessage(err: ApiError): string | null {
  switch (err.code) {
    case 'CLASS_FULL':
      return translate('lib.apiError.classFull');
    // "Delete my account": the shared wording in @ultm8/i18n.
    case 'ACCOUNT_CLOSING':
      return translate('server.codes.accountClosing');
    case 'ACCOUNT_LOCKED':
      return translate('server.codes.accountLocked');
    case 'MAIN_OWNER_MUST_HAND_OVER':
      return translate('server.codes.mainOwnerMustHandOver');
    case 'SUBSCRIPTION_NOT_STOPPED':
      return translate('server.codes.subscriptionNotStopped');
    case 'WAITLIST_FIRST':
      return translate('lib.apiError.waitlistFirst');
    case 'BOOKING_CLOSED':
      return translate('lib.apiError.bookingClosed');
    // "Who can book" (Decision 432): the shared wording in @ultm8/i18n.
    case 'WHO_CAN_BOOK_GENDER':
      return translate(/for women only/.test(err.message) ? 'server.codes.whoCanBookWomenOnly' : 'server.codes.whoCanBookMenOnly');
    case 'WHO_CAN_BOOK_GENDER_MISSING':
      return translate('server.codes.whoCanBookGenderMissing');
    case 'WHO_CAN_BOOK_AGE':
      return translate('server.codes.whoCanBookAge');
    case 'WHO_CAN_BOOK_AGE_MISSING':
      return translate('server.codes.whoCanBookAgeMissing');
    case 'CLASS_BUSY':
      return translate('lib.apiError.classBusy');
    case 'TICKET_REQUIRED':
      return translate('lib.apiError.ticketRequired');
    // Decision 393: a Class Pack with no classes left.
    case 'PACK_USED_UP':
      return translate('lib.apiError.packUsedUp');
    // Decision 449 item 8: no plan of theirs pays for this class.
    case 'NO_ELIGIBLE_MEMBERSHIP':
      return translate('server.codes.noEligibleMembership');
    // Decision 449 item 6: people connected to the School are told why.
    case 'ACCESS_PAUSED':
      return translate('server.codes.accessPaused');
    case 'NO_PERMISSION':
      return translate('server.codes.noPermission');
    case 'CHECK_IN_NOT_OPEN': {
      const iso = err.message.match(/opens at (\S+?)\.?$/)?.[1];
      return iso && !Number.isNaN(new Date(iso).getTime())
        ? translate('lib.apiError.checkInNotOpenAt', { time: formatDateTime(iso) })
        : translate('lib.apiError.checkInNotOpen');
    }
    // The School's check-in rules (Decision 394, backlog §3.5): the shared wording in @ultm8/i18n.
    case 'CHECK_IN_WAIVER_REQUIRED':
      return translate('server.codes.checkInWaiverRequired');
    // Decision 441: "Waiver must be signed before booking or check-in".
    case 'WAIVER_REQUIRED':
      return translate('server.codes.waiverRequired');
    case 'CHECK_IN_HOME_BRANCH_ONLY':
      return translate('server.codes.checkInHomeBranchOnly');
    case 'CHECK_IN_VISITORS_OFF':
      return translate('server.codes.checkInVisitorsOff');
    case 'CHECK_IN_PAYMENT_OVERDUE':
      return translate('server.codes.checkInPaymentOverdue');
    // Freezing a membership (Decision 404): the shared wording in @ultm8/i18n.
    case 'MEMBERSHIP_FROZEN':
      return translate('server.codes.membershipFrozen');
    case 'FREEZE_OVER_LIMIT': {
      const max = Number(err.message.match(/at most (\d+) frozen days/)?.[1]);
      const left = Number(err.message.match(/(\d+) days are left/)?.[1]);
      return Number.isFinite(max) && Number.isFinite(left) ? translate('server.codes.freezeOverLimit', { max, left }) : null;
    }
    case 'FREEZE_TOO_SHORT':
      return translate('server.codes.freezeTooShort');
    case 'FREEZE_START_PASSED':
      return translate('server.codes.freezeStartPassed');
    case 'FREEZE_DATES_REQUIRED':
      return translate('server.codes.freezeDatesRequired');
    case 'FREEZE_OVERLAP':
      return translate('server.codes.freezeOverlap');
    case 'FREEZE_CLASS_PACK':
      return translate('server.codes.freezeClassPack');
    case 'FREEZE_NOT_FREEZABLE':
      return translate('server.codes.freezeNotFreezable');
    case 'FREEZE_MEMBERSHIP_ENDED':
      return translate('server.codes.freezeMembershipEnded');
    case 'FREEZE_CANCELLING':
      return translate('server.codes.freezeCancelling');
    case 'FREEZE_AFTER_END':
      return translate('server.codes.freezeAfterEnd');
    case 'FREEZE_ALREADY_DECIDED':
      return translate('server.codes.freezeAlreadyDecided');
    case 'FREEZE_NOT_RUNNING':
      return translate('server.codes.freezeNotRunning');
    case 'FREEZE_NOT_FOUND':
      return translate('server.codes.freezeNotFound');
    case 'FREEZE_FEE_NO_PAYMENTS':
      return translate('server.codes.freezeFeeNoPayments');
    // Decision 442 item 2: no card payments until Stripe says the School's account is ready.
    case 'CARD_PAYMENTS_NOT_READY':
      return translate('server.codes.cardPaymentsNotReady');
    // The School's free trial of ULTM8 ended (backlog 3.14).
    case 'TRIAL_ENDED':
      return translate('lib.apiError.trialEnded');
    // Families (Decision 430).
    case 'CONSENT_PENDING':
      return translate('server.codes.consentPending');
    case 'CONSENT_WITHDRAWN':
      return translate('server.codes.consentWithdrawn');
    case 'CHILD_IS_ADULT':
      return translate('server.codes.childIsAdult');
    case 'CHILD_ADULT_ACCESS_ENDED':
      return translate('server.codes.childAdultAccessEnded');
    case 'GUARDIAN_UNDER_18':
      return translate('server.codes.guardianUnder18');
    // Legal go-live (Decision 444).
    case 'TERMS_NOT_ACCEPTED':
      return translate('server.codes.termsNotAccepted');
    // Decision 448 item 8: the first-sign-in "I agree" is still to be ticked.
    case 'LEGAL_ACCEPTANCE_REQUIRED':
      return translate('server.codes.legalAcceptanceRequired');
    case 'REGISTER_UNDER_18':
      return translate('server.codes.registerUnder18');
    case 'AGREEMENT_NOT_ACCEPTED':
      return translate('server.codes.agreementNotAccepted');
    case 'NOT_A_MINOR':
      return translate('server.codes.notAMinor');
    case 'CHILD_ALREADY_HERE':
      return translate('server.codes.childAlreadyHere');
    case 'ALREADY_GUARDIAN':
      return translate('server.codes.alreadyGuardian');
    case 'NOT_GUARDIAN_MANAGED':
      return translate('server.codes.notGuardianManaged');
    case 'GUARDIAN_IS_CHILD':
      return translate('server.codes.guardianIsChild');
    case 'LAST_GUARDIAN':
      return translate('server.codes.lastGuardian');
    case 'IDENTITY_SHARED':
      return translate('server.codes.identityShared');
    case 'EMAIL_IN_USE':
      return translate('server.codes.emailInUse');
    case 'UNDER_18_SELF':
      return translate('server.codes.under18Self');
    case 'BIRTH_DATE_NEEDED':
      return translate('server.codes.birthDateNeeded');
    // Belt correction requests (backlog 3.13).
    case 'CORRECTION_NOT_VERIFIED':
      return translate('lib.apiError.correctionNotVerified');
    case 'CORRECTION_PENDING':
      return translate('lib.apiError.correctionPending');
    case 'CORRECTION_SAME_RANK':
      return translate('lib.apiError.correctionSameRank');
    default:
      return null;
  }
}

/** Whether a booking attempt was refused because the Class is full or Students
 * are already queued for it — either way, the next step is the waitlist. */
export function isWaitlistNext(err: unknown): boolean {
  return err instanceof ApiError && (err.code === 'CLASS_FULL' || err.code === 'WAITLIST_FIRST');
}

/** Decision 449 item 8: whether a booking or a waiting-list claim was refused
 * because no plan of the member's covers it (none at all, none for this
 * class, or a Class Pack used up): the refusal that gets a "Buy a plan"
 * button. A one-off class's own ticket (TICKET_REQUIRED) has its own offer
 * (ClassTicketOffer), and a frozen or not-yet-started plan isn't fixed by
 * buying another. */
export function isPlanRefusal(err: unknown): boolean {
  return err instanceof ApiError && (err.code === 'NO_ELIGIBLE_MEMBERSHIP' || err.code === 'PACK_USED_UP');
}

/** Whether a booking, a waiting-list join or claim, or a check-in was refused
 * because the School needs a signed waiver first (Decision 441 item 5): the
 * refusal that gets a "Sign the waiver" button (Decision 442 item 1). */
export function isWaiverRefusal(err: unknown): boolean {
  return err instanceof ApiError && (err.code === 'WAIVER_REQUIRED' || err.code === 'CHECK_IN_WAIVER_REQUIRED');
}
