import { createHash, createHmac } from 'crypto';

/**
 * Guest waiver links (Waivers Q9). Each guest seat on a booking has one link,
 * `${PORTAL_BASE_URL}/guest-waiver/${token}`. The token is derived from the
 * seat id with an HMAC keyed by JWT_ACCESS_SECRET, so the booker can fetch the
 * same link again and the database keeps only its SHA-256 (as coach invites
 * do). Changing JWT_ACCESS_SECRET changes every link; links are only useful
 * until the class ends anyway.
 */
export function guestWaiverToken(attendeeId: string): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET is not set');
  return createHmac('sha256', secret).update(`guest-waiver-link:v1:${attendeeId}`).digest('base64url');
}

export function hashGuestWaiverToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The signing page's address for a seat, or null when PORTAL_BASE_URL isn't set. */
export function guestWaiverLink(attendeeId: string): string | null {
  const base = process.env.PORTAL_BASE_URL?.trim().replace(/\/+$/, '');
  return base ? `${base}/guest-waiver/${guestWaiverToken(attendeeId)}` : null;
}
