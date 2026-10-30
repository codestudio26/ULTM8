import type { MessageVars } from '../types';
import { formatLocale } from '../format';

type Translate = (key: string, vars?: MessageVars) => string;

/**
 * Booking and schedule errors the API marks with their own code (Decision 322).
 * Their English text names API fields and endpoints ("POST /classes/{id}/waitlist",
 * "bookedClasses MOVE, CANCEL or KEEP"), so every language — English included —
 * shows the portal's own wording instead. The counts and times come from the
 * API's English message, which is what the error translator receives.
 */
export function translateByCode(t: Translate, code: string, message: string): string | null {
  switch (code) {
    case 'CLASS_FULL':
      return t('server.codes.classFull');
    case 'WAITLIST_FIRST':
      return t('server.codes.waitlistFirst');
    case 'BOOKING_CLOSED':
      return t('server.codes.bookingClosed');
    case 'CLASS_BUSY':
      return t('server.codes.classBusy');
    // The locked tablet, someone found by name (Decision 388).
    case 'KIOSK_BOOK_FIRST':
      return t('server.codes.kioskBookFirst');
    // Pack used up at check-in (Decision 393).
    case 'PACK_USED_UP':
      return t('server.codes.packUsedUp');
    case 'NO_PACK_TO_RECHARGE':
      return t('server.codes.noPackToRecharge');
    case 'PACK_NOT_FOR_SALE':
      return t('server.codes.packNotForSale');
    case 'RECHARGE_NOT_PAID':
      return t('server.codes.rechargeNotPaid');
    // Visit passes (Decision 391).
    case 'VISITOR_PERIOD_NOT_SET':
      return t('server.codes.visitorPeriodNotSet');
    case 'VISITOR_HAS_MEMBERSHIP':
      return t('server.codes.visitorHasMembership');
    // Sign-ups from the tablet (Decision 392).
    case 'SIGN_UP_UNDER_18':
      return t('server.codes.signUpUnder18');
    case 'SIGN_UP_WAITING':
      return t('server.codes.signUpWaiting');
    case 'SIGN_UP_ALREADY_STUDENT':
      return t('server.codes.signUpAlreadyStudent');
    // Kids and Adult programs (backlog 3.20).
    case 'ADULT_NOT_LINKED':
      return t('server.codes.adultNotLinked');
    case 'ADULT_TOO_YOUNG':
      return t('server.codes.adultTooYoung');
    case 'ADULT_ALREADY':
      return t('server.codes.adultAlready');
    case 'ADULT_FIRST_BELT':
      return t('server.codes.adultFirstBelt');
    // The School's check-in rules (Decision 394).
    case 'CHECK_IN_WAIVER_REQUIRED':
      return t('server.codes.checkInWaiverRequired');
    case 'CHECK_IN_HOME_BRANCH_ONLY':
      return t('server.codes.checkInHomeBranchOnly');
    case 'CHECK_IN_VISITORS_OFF':
      return t('server.codes.checkInVisitorsOff');
    case 'CHECK_IN_ONE_CLASS':
      return t('server.codes.checkInOneClass');
    // Freezing a membership (Decision 404).
    case 'MEMBERSHIP_FROZEN':
      return t('server.codes.membershipFrozen');
    case 'FREEZE_OVER_LIMIT': {
      const max = Number(message.match(/at most (\d+) frozen days/)?.[1]);
      const left = Number(message.match(/(\d+) days are left/)?.[1]);
      return Number.isFinite(max) && Number.isFinite(left) ? t('server.codes.freezeOverLimit', { max, left }) : null;
    }
    case 'FREEZE_TOO_SHORT':
      return t('server.codes.freezeTooShort');
    case 'FREEZE_START_PASSED':
      return t('server.codes.freezeStartPassed');
    case 'FREEZE_DATES_REQUIRED':
      return t('server.codes.freezeDatesRequired');
    case 'FREEZE_OVERLAP':
      return t('server.codes.freezeOverlap');
    case 'FREEZE_CLASS_PACK':
      return t('server.codes.freezeClassPack');
    case 'FREEZE_NOT_FREEZABLE':
      return t('server.codes.freezeNotFreezable');
    case 'FREEZE_MEMBERSHIP_ENDED':
      return t('server.codes.freezeMembershipEnded');
    case 'FREEZE_CANCELLING':
      return t('server.codes.freezeCancelling');
    case 'FREEZE_AFTER_END':
      return t('server.codes.freezeAfterEnd');
    case 'FREEZE_ALREADY_DECIDED':
      return t('server.codes.freezeAlreadyDecided');
    case 'FREEZE_NOT_RUNNING':
      return t('server.codes.freezeNotRunning');
    case 'FREEZE_NOT_FOUND':
      return t('server.codes.freezeNotFound');
    case 'FREEZE_FEE_NO_PAYMENTS':
      return t('server.codes.freezeFeeNoPayments');
    // A free trial of ULTM8 that ended (backlog 3.14).
    case 'TRIAL_ENDED':
      return t('server.codes.trialEnded');
    // Belt correction requests (backlog 3.13).
    case 'CORRECTION_NOT_VERIFIED':
      return t('server.codes.correctionNotVerified');
    case 'CORRECTION_PENDING':
      return t('server.codes.correctionPending');
    case 'CORRECTION_SAME_RANK':
      return t('server.codes.correctionSameRank');
    case 'CORRECTION_STALE':
      return t('server.codes.correctionStale');
    case 'CORRECTION_RUNG_GONE':
      return t('server.codes.correctionRungGone');
    case 'CORRECTION_ANSWERED':
      return t('server.codes.correctionAnswered');
    case 'CHECK_IN_NOT_OPEN': {
      const iso = message.match(/opens at (\S+?)\.?$/)?.[1];
      const opensAt = iso ? new Date(iso) : null;
      if (!opensAt || Number.isNaN(opensAt.getTime())) return t('server.codes.checkInNotOpen');
      const time = opensAt.toLocaleString(formatLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
      return t('server.codes.checkInOpensAt', { time });
    }
    case 'CAPACITY_BELOW_BOOKED': {
      const taken = Number(message.match(/(\d+) students? (?:is |are )?booked/)?.[1]);
      return Number.isFinite(taken) && taken > 0 ? t('server.codes.capacityBelowBooked', { count: taken }) : null;
    }
    case 'BOOKED_CLASSES_CHOICE_REQUIRED':
      return t('server.codes.bookedClassesChoice');
    // Classes review (C8, C11, C13).
    case 'CLASS_ARCHIVED':
      return t('server.codes.classArchived');
    case 'QR_WINDOW_BEFORE_START':
      return t('server.codes.qrWindowBeforeStart');
    case 'BOOKING_CUTOFF_AFTER_END':
      return t('server.codes.bookingCutoffAfterEnd');
    case 'REFUND_CUTOFF_AFTER_END':
      return t('server.codes.refundCutoffAfterEnd');
    case 'GUEST_NEEDS_FRIEND_PASS':
      return t('server.codes.guestNeedsFriendPass');
    case 'GUEST_PASS_REPEATED':
      return t('server.codes.guestPassRepeated');
    // Classes review second batch (Decision 345: C1, C5, C14, past Classes).
    case 'TICKET_REQUIRED':
      return t('server.codes.ticketRequired');
    case 'CLASS_BRANCH_BOOKED':
      return t('server.codes.classBranchBooked');
    case 'CLASS_MOVED_TO_PAST':
      return t('server.codes.classMovedToPast');
    case 'CLASS_ALREADY_ENDED':
      return t('server.codes.classAlreadyEnded');
    // School Settings review (Decision 368, Q3) — the count and currency come from the API's English text.
    case 'SCHOOL_CURRENCY_CHANGE_CONFIRM': {
      const n = Number(message.match(/^(\d+) membership plan/)?.[1]);
      const currency = message.match(/charged in ([A-Z]{3}) from now on/)?.[1];
      return Number.isFinite(n) && currency ? t('server.codes.schoolCurrencyChange', { count: n, currency }) : null;
    }
    case 'SCHOOL_CURRENCY_IN_USE': {
      const n = Number(message.match(/^(\d+) membership plan/)?.[1]);
      return Number.isFinite(n) ? t('server.codes.schoolCurrencyInUse', { count: n }) : null;
    }
    default:
      return null;
  }
}
