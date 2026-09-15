import { ForbiddenException, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

const READ_ONLY_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

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
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
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
  }

  async validate(req: Request, payload: JwtPayload): Promise<JwtPayload> {
    if (payload.impersonation && !READ_ONLY_HTTP_METHODS.has(req.method)) {
      throw new ForbiddenException(
        'This is a read-only impersonation session — write actions are not permitted (Decision 102).',
      );
    }
    return payload;
  }
}
