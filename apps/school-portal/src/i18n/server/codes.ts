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
