import { ApiError } from '@ultm8/api-client';

/** Every screen in this app needs "show the real backend message if there is one,
 * otherwise a friendly fallback" — this was duplicated as the same
 * `err instanceof ApiError ? err.message : '<fallback>'` ternary at 12+ call sites
 * (auth screens, academies, bookings) before being extracted here on review. */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}
