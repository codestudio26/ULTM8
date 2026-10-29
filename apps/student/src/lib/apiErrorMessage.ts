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
    case 'CHECK_IN_NOT_OPEN': {
      const iso = err.message.match(/opens at (\S+?)\.?$/)?.[1];
      return iso && !Number.isNaN(new Date(iso).getTime())
        ? translate('lib.apiError.checkInNotOpenAt', { time: formatDateTime(iso) })
        : translate('lib.apiError.checkInNotOpen');
    }
    // The School's free trial of ULTM8 ended (backlog 3.14).
    case 'TRIAL_ENDED':
      return translate('lib.apiError.trialEnded');
    default:
      return null;
  }
}

/** Whether a booking attempt was refused because the Class is full or Students
 * are already queued for it — either way, the next step is the waitlist. */
export function isWaitlistNext(err: unknown): boolean {
  return err instanceof ApiError && (err.code === 'CLASS_FULL' || err.code === 'WAITLIST_FIRST');
}
