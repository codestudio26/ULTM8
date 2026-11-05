import { createHash, createHmac, randomBytes } from 'crypto';

/**
 * Decision 319 item 4: a staff member's private calendar link. The token is
 * derived from the feed row's id with an HMAC keyed by JWT_ACCESS_SECRET (as
 * guest waiver links are, guest-waiver-token.ts), so the person can see the
 * same link again; the database keeps only its SHA-256. A new link is a new
 * row; changing JWT_ACCESS_SECRET turns every link off.
 */
export function calendarFeedToken(feedId: string): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET is not set');
  return createHmac('sha256', secret).update(`staff-calendar-feed:v1:${feedId}`).digest('base64url');
}

export function hashCalendarFeedToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The schedule embed's key: random, public by nature (it sits in the
 * School's own web page), replaced to turn an old link off. */
export function newScheduleEmbedKey(): string {
  return randomBytes(24).toString('base64url');
}

/** Tokens and keys are base64url; anything else is refused before any lookup. */
export function isLinkToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{20,64}$/.test(value);
}
