import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'crypto';

/**
 * The token a locked front-desk tablet holds (Decision 380). A JWT signed with
 * its own key, derived from JWT_ACCESS_SECRET, so the staff login strategy
 * (JwtStrategy) never accepts it and it can never be used as a staff login;
 * the front-desk kiosk guard is the only thing that verifies it. Its `sub` is
 * `front-desk:<sessionId>`, which only buckets rate limits (ip-limit.ts,
 * identity-trackers.ts); the session row decides whether it still works.
 */
export interface FrontDeskSessionClaims {
  sid: string;
  sub: string;
  typ: 'front-desk-session';
}

let signer: { base: string; jwt: JwtService } | null = null;

/** Null when JWT_ACCESS_SECRET isn't set (the request is then refused). */
export function frontDeskSessionJwt(): JwtService | null {
  const base = process.env.JWT_ACCESS_SECRET;
  if (!base) return null;
  if (signer?.base !== base) {
    signer = { base, jwt: new JwtService({ secret: createHmac('sha256', base).update('front-desk-session').digest('hex') }) };
  }
  return signer.jwt;
}

/** The session id in a valid front-desk token, or null. Checks the signature,
 * expiry and shape only, not whether the session has ended. */
export function verifyFrontDeskSessionToken(token: string): string | null {
  const jwt = frontDeskSessionJwt();
  if (!jwt) return null;
  try {
    const claims = jwt.verify<FrontDeskSessionClaims>(token);
    return claims?.typ === 'front-desk-session' && typeof claims.sid === 'string' ? claims.sid : null;
  } catch {
    return null;
  }
}
