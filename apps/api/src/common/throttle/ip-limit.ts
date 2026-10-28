import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verifyFrontDeskSessionToken } from '../../front-desk/front-desk-session-token';

/** Requests per minute per IP for a caller who isn't signed in
 * (THROTTLE_IP_LIMIT_PER_MINUTE, default 60). Only the browser tests raise it:
 * they drive the whole portal from one address. A missing or invalid value
 * keeps the default. */
export function ipLimitPerMinute(): number {
  const n = Number(process.env.THROTTLE_IP_LIMIT_PER_MINUTE);
  return Number.isInteger(n) && n > 0 ? n : 60;
}

/*
 * The `default` throttler, per IP for callers who aren't signed in. Product
 * owner, 28 Oct 2026: everyone at a School on the same WiFi shares one address,
 * so a busy front desk could hit 60 a minute. A signed-in caller is counted on
 * their own, not with their IP, and has no limit here: the `identity` throttler
 * (1000 a minute per user) limits them instead.
 *
 * "Signed in" means a bearer token that verifies: signed with
 * JWT_ACCESS_SECRET and not expired. A token that is only decoded would let
 * anyone leave the IP limit with a made-up token. Signed-in requests don't count
 * towards their IP, so an expired token after a busy minute still gets its 401
 * (and the app refreshes), not a 429.
 *
 * A locked front-desk tablet (Decision 380) counts as signed in the same way:
 * its session token verifies with the front-desk key, and it is counted on its
 * own as `front-desk:<sessionId>`.
 *
 * A route that sets its own `default` limit (login, public School search, guest
 * waivers, bulk promote) keeps it: the guard uses the route's limit in place of
 * defaultIpLimit, counted per user when signed in and per IP otherwise.
 */
export function defaultIpLimit(context: ExecutionContext): number {
  return verifiedSub(context.switchToHttp().getRequest()) ? Number.MAX_SAFE_INTEGER : ipLimitPerMinute();
}

export async function defaultIpTracker(req: Record<string, any>): Promise<string> {
  const sub = verifiedSub(req);
  return sub ? `signed-in:${sub}` : `ip:${req.ip}`;
}

let verifier: { secret: string; jwt: JwtService } | null = null;
// Each request is verified once, for both the tracker and the limit.
const verified = new WeakMap<object, string | null>();

export function verifiedSub(req: Record<string, any>): string | null {
  if (verified.has(req)) return verified.get(req)!;
  let sub: string | null = null;
  const header = req.headers?.authorization as string | undefined;
  const secret = process.env.JWT_ACCESS_SECRET;
  if (header?.startsWith('Bearer ') && secret) {
    if (verifier?.secret !== secret) verifier = { secret, jwt: new JwtService({ secret }) };
    const token = header.slice('Bearer '.length);
    try {
      const payload = verifier.jwt.verify(token);
      sub = typeof payload?.sub === 'string' ? payload.sub : null;
    } catch {
      const sessionId = verifyFrontDeskSessionToken(token);
      sub = sessionId ? `front-desk:${sessionId}` : null;
    }
  }
  verified.set(req, sub);
  return sub;
}
