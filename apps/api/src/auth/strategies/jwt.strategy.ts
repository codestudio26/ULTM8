import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { RequestContext } from '../../common/request-context';
import { RolesChangedService } from '../../common/prisma/roles-changed.service';

const READ_ONLY_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Decision 123 — the ONE route a Kid-Mode-scoped token may ever call. Matched
// against req.path (includes the 'v1' global prefix, main.ts's own
// setGlobalPrefix) rather than req.route, since passport's strategy runs before
// Nest's router has resolved a route match.
const KID_MODE_ALLOWED_PATH = /^\/v1\/classes\/[^/]+\/book$/;

// Decision 1/230 — the ONE route a passcode-change-purpose token (minted by
// AuthService.login() when mustChangePasscode is true) may ever call. Same
// route-allowlist mechanism as KID_MODE_ALLOWED_PATH above — this token
// carries zero grants and must never reach any ordinary tenant endpoint.
const PASSCODE_CHANGE_ALLOWED_PATH = /^\/v1\/auth\/passcode-change\/first-login$/;

/**
 * Validates the access token and hands back its claims as `req.user`. 15-minute
 * access-token TTL for customer identities is confirmed (Spec §8.3) — configured via
 * JWT_ACCESS_TTL in AuthModule's JwtModule.register(), not here.
 *
 * Phase 43 (Decision 102) — `passReqToCallback: true` added so `validate()` can see
 * the incoming request's own HTTP method, not just the token's claims. This is the
 * ONE central choke point every tenant request already passes through regardless
 * of which of this codebase's ~20 controllers it hits (each one only ever does
 * `@UseGuards(JwtAuthGuard)`, which invokes this strategy) — read-only enforcement
 * for an impersonation session lives here rather than being retrofitted onto every
 * controller's own guard list one at a time. A token carrying `impersonation`
 * (see JwtPayload's own comment — only AuthService.issueImpersonationToken() ever
 * sets it) making a non-GET/HEAD/OPTIONS request is rejected outright, before the
 * request ever reaches a controller.
 *
 * Phase 47 — this same choke point is also where `RequestContext` learns an active
 * impersonation session's own `schoolId`, for `PrismaAppService.withTenantContext`
 * to pick up later in the request (see `RequestContext`'s own header comment for
 * the full mechanism and why it's a plain `AsyncLocalStorage`, not DI). Populating
 * it here — once, centrally — rather than requiring every controller/service that
 * calls `withTenantContext` to separately extract and forward it is the same
 * "one central choke point, not ~20 retrofits" reasoning the read-only check above
 * already established.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly rolesChanged: RolesChangedService;

  constructor(rolesChanged: RolesChangedService) {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) {
      // Fail loudly at boot rather than silently signing/verifying with an undefined
      // secret — a missing secret is a misconfiguration, not a runtime-recoverable case.
      throw new Error('JWT_ACCESS_SECRET is not set');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      passReqToCallback: true,
    });
    this.rolesChanged = rolesChanged;
  }

  async validate(req: Request, payload: JwtPayload): Promise<JwtPayload> {
    if (payload.impersonation && !READ_ONLY_HTTP_METHODS.has(req.method)) {
      throw new ForbiddenException(
        'This is a read-only impersonation session — write actions are not permitted (Decision 102).',
      );
    }
    if (payload.impersonation) {
      RequestContext.setImpersonationSchoolId(payload.impersonation.schoolId);
    }
    // Decision 123 — a Kid-Mode token may only create a Booking for the one
    // linked minor it was minted for, nothing else. Rejecting here, before any
    // controller/service runs, mirrors the impersonation read-only check above
    // rather than relying on the client to simply not call another endpoint.
    // Still re-verified live against BookingDelegation inside BookingsController
    // itself (never trust the claim alone) — this check only narrows WHICH
    // request shape is even allowed through.
    if (payload.kidMode) {
      const isAllowedRoute = req.method === 'POST' && KID_MODE_ALLOWED_PATH.test(req.path);
      const bodyStudentId = (req.body as Record<string, unknown> | undefined)?.studentId;
      const bodyOverrideReason = (req.body as Record<string, unknown> | undefined)?.overrideReason;
      if (!isAllowedRoute || bodyStudentId !== payload.kidMode.studentId || bodyOverrideReason !== undefined) {
        throw new ForbiddenException(
          'This is a Kid-Mode session — it may only book a Class for the one linked minor it was issued for (Decision 123).',
        );
      }
    }
    // Decision 1/230 — same "one central choke point" reasoning as Kid Mode
    // above: a passcode-change-purpose token may only call the one endpoint
    // that consumes it, never anything else, even though it technically
    // verifies against the same secret as an ordinary access token.
    if (payload.passcodeChangePurpose) {
      const isAllowedRoute = req.method === 'POST' && PASSCODE_CHANGE_ALLOWED_PATH.test(req.path);
      if (!isAllowedRoute) {
        throw new ForbiddenException(
          'This token only confirms a forced passcode change — it cannot be used for anything else.',
        );
      }
    }
    // Decision 361 — a token built before the user's roles last changed is
    // refused, so a removed staff member loses access on their next request
    // instead of up to 15 minutes later. The apps treat any 401 by refreshing,
    // and the refreshed token carries the current roles, so nobody is signed
    // out. If the stamp can't be read, stampFor() throws and the request is
    // refused: never let a possibly-removed person through.
    if (typeof payload.rca === 'number') {
      const current = await this.rolesChanged.stampFor(payload.sub);
      if (current > payload.rca) {
        throw new UnauthorizedException({ code: 'ROLES_CHANGED', message: 'Your roles have changed. Please refresh your session.' });
      }
    }
    return payload;
  }
}
