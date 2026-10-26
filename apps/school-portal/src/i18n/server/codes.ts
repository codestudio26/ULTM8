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
    default:
      return null;
  }
}
