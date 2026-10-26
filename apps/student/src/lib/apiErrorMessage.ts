import { ApiError } from '@ultm8/api-client';
import { formatDateTime } from './formatDate';

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
      return 'This class is full. You can join the waitlist instead.';
    case 'WAITLIST_FIRST':
      return 'Others are already waiting for a place in this class. Join the waitlist to take your turn.';
    case 'BOOKING_CLOSED':
      return 'Booking for this class has closed. A member of staff can still add you.';
    case 'CLASS_BUSY':
      return 'Lots of people are booking this class right now. Please try again in a moment.';
    case 'CHECK_IN_NOT_OPEN': {
      const iso = err.message.match(/opens at (\S+?)\.?$/)?.[1];
      return iso && !Number.isNaN(new Date(iso).getTime())
        ? `Check-in for this class hasn't opened yet. It opens ${formatDateTime(iso)}.`
        : "Check-in for this class hasn't opened yet.";
    }
    default:
      return null;
  }
}

/** Whether a booking attempt was refused because the Class is full or Students
 * are already queued for it — either way, the next step is the waitlist. */
export function isWaitlistNext(err: unknown): boolean {
  return err instanceof ApiError && (err.code === 'CLASS_FULL' || err.code === 'WAITLIST_FIRST');
}
