/**
 * Per-identity throttle trackers — the "per-user" half of Decision 17's "per-user/
 * per-IP throttling," meant to run alongside (not replace) the existing IP-keyed
 * `default` named throttler registered in app.module.ts's ThrottlerModule.forRoot.
 * Each tracker below keys on ONLY the identity signal, no IP mixed in: the two
 * dimensions are independent, AND-ed throttlers (NestJS's ThrottlerGuard runs every
 * named throttler for a route and requires all of them to pass), not a single
 * combined key. This mirrors LoginAttemptTracker's own precedent of keying purely
 * by account identity, decoupled from IP (Decision 12).
 */

/**
 * Keys by the first present identity field in the request body (e.g. `email` or
 * `phone`, whichever the DTO on that route actually collects). Falls back to the
 * caller's IP only if the body has neither — a malformed request that class-validator
 * will reject anyway, not a real identity to bucket by.
 */
export function bodyIdentityTracker(...fields: Array<'email' | 'phone'>) {
  // `req` is typed to match @nestjs/throttler's own ThrottlerGetTrackerFunction
  // signature (Record<string, any>, not Express's Request) — see getTracker(req)
  // on ThrottlerGuard itself, which takes the same loose shape.
  return async (req: Record<string, any>): Promise<string> => {
    const body = req.body as Record<string, unknown> | undefined;
    for (const field of fields) {
      const value = body?.[field];
      if (typeof value === 'string' && value.length > 0) {
        return `${field}:${value.toLowerCase()}`;
      }
    }
    return `ip:${req.ip}`;
  };
}

/**
 * Extracts the caller's JWT `sub` claim WITHOUT verifying the signature — this is
 * only a rate-limit bucketing key, never a trust decision. Nest's global guards
 * (ThrottlerGuard is registered via APP_GUARD in app.module.ts) run before any
 * controller-scoped guard (JwtAuthGuard), so `req.user` is not populated yet when
 * this runs. A forged or expired token is still rejected downstream by
 * JwtAuthGuard/JwtStrategy with a 401 exactly as before — this only affects which
 * bucket an as-yet-unauthenticated-at-this-point request counts against.
 */
export async function jwtSubTracker(req: Record<string, any>): Promise<string> {
  const payload = unverifiedJwtPayload(req);
  return typeof payload?.sub === 'string' ? `sub:${payload.sub}` : `ip:${req.ip}`;
}

// The bearer token's claims, NOT verified (see jwtSubTracker), or null.
function unverifiedJwtPayload(req: Record<string, any>): Record<string, any> | null {
  const header = req.headers?.authorization as string | undefined;
  if (!header?.startsWith('Bearer ')) return null;
  const parts = header.slice('Bearer '.length).split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

const STAFF_ROLES = ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF', 'INSTRUCTOR'];

/**
 * Whether this request is a staff member booking for someone else: the body
 * names another student and the token carries a staff role. Product owner, 28 Oct
 * 2026: a front desk books many students a minute, so staff booking on someone's
 * behalf get their own, higher per-user limit; a Student's (or Guardian's) own
 * booking limit is unchanged. Like jwtSubTracker this only picks a rate-limit
 * bucket: the token is checked by JwtAuthGuard afterwards, and BookingsService
 * still checks the staff role at the Class's School.
 */
export function isStaffBookingOnBehalf(req: Record<string, any>): boolean {
  const payload = unverifiedJwtPayload(req);
  const studentId = (req.body as Record<string, unknown> | undefined)?.studentId;
  if (typeof payload?.sub !== 'string' || typeof studentId !== 'string' || studentId === payload.sub) return false;
  const grants = Array.isArray(payload.grants) ? payload.grants : [];
  return grants.some((g: { role?: unknown }) => typeof g?.role === 'string' && STAFF_ROLES.includes(g.role));
}

/** jwtSubTracker, with a separate bucket for staff booking on someone's behalf
 * (isStaffBookingOnBehalf), so the two limits don't share a count. */
export async function bookingTracker(req: Record<string, any>): Promise<string> {
  const tracker = await jwtSubTracker(req);
  return isStaffBookingOnBehalf(req) ? `${tracker}:on-behalf` : tracker;
}
