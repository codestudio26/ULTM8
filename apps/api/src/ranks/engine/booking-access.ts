import { Rung, rungIndex } from './ladder';

/**
 * Grading engine — may a student book a class of this type in this style
 * (Decision 173)? The school owner decides, per rung: a rung's "unlocks
 * booking" list opens those class types to that rung and every rung above it.
 *
 * - OPEN: anyone may book. The class has no type, or no rung of the style
 *   unlocks this type, so it isn't restricted. A style where nothing is set
 *   is open throughout.
 * - UNLOCKED: restricted, and the student's rung or a rung below it unlocks it.
 * - LOCKED: restricted, and the student hasn't reached a rung that unlocks it
 *   (or has no rung in this style). Staff can override per booking.
 */
export type BookingAccess = 'OPEN' | 'UNLOCKED' | 'LOCKED';

export function bookingAccess(ladder: Rung[], currentRungId: string | null, classType: string | null): BookingAccess {
  if (classType === null) return 'OPEN';
  const unlockAt = ladder.findIndex((r) => r.bookingUnlocksClassTypes.includes(classType));
  if (unlockAt < 0) return 'OPEN';
  const at = currentRungId === null ? -1 : rungIndex(ladder, currentRungId);
  return at >= unlockAt ? 'UNLOCKED' : 'LOCKED';
}
