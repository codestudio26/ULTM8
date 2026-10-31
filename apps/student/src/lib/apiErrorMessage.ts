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
    case 'WAITLIST_FIRST':
      return translate('lib.apiError.waitlistFirst');
    case 'BOOKING_CLOSED':
      return translate('lib.apiError.bookingClosed');
    case 'CLASS_BUSY':
      return translate('lib.apiError.classBusy');
    case 'TICKET_REQUIRED':
      return translate('lib.apiError.ticketRequired');
    // Decision 393: a Class Pack with no classes left.
    case 'PACK_USED_UP':
      return translate('lib.apiError.packUsedUp');
    case 'CHECK_IN_NOT_OPEN': {
      const iso = err.message.match(/opens at (\S+?)\.?$/)?.[1];
      return iso && !Number.isNaN(new Date(iso).getTime())
        ? translate('lib.apiError.checkInNotOpenAt', { time: formatDateTime(iso) })
        : translate('lib.apiError.checkInNotOpen');
    }
    // The School's check-in rules (Decision 394, backlog §3.5): the shared wording in @ultm8/i18n.
    case 'CHECK_IN_WAIVER_REQUIRED':
      return translate('server.codes.checkInWaiverRequired');
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
    // The School's free trial of ULTM8 ended (backlog 3.14).
    case 'TRIAL_ENDED':
      return translate('lib.apiError.trialEnded');
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
