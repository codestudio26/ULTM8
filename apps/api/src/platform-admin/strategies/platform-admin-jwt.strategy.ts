import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AdminJwtPayload } from '../interfaces/admin-jwt-payload.interface';

/**
 * Validates ULTM8's own Platform Admin access token and hands its claims back as
 * `req.user`. Mirrors apps/api/src/auth/strategies/jwt.strategy.ts exactly in shape,
 * deliberately NOT reusing it — a different Passport strategy name ('platform-admin-jwt'
 * vs the default 'jwt' the tenant strategy registers as) and a different secret
 * (PLATFORM_ADMIN_JWT_SECRET) are what make the two realms structurally incapable of
 * verifying each other's tokens, not just a naming convention (ultm8-tenant-isolation
 * SKILL.md §3).
 */
@Injectable()
export class PlatformAdminJwtStrategy extends PassportStrategy(Strategy, 'platform-admin-jwt') {
  constructor() {
    const secret = process.env.PLATFORM_ADMIN_JWT_SECRET;
    if (!secret) {
      // Fail loudly at boot, same convention JwtStrategy already established — a
      // missing secret is a misconfiguration, not a runtime-recoverable case.
      throw new Error('PLATFORM_ADMIN_JWT_SECRET is not set');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: AdminJwtPayload): Promise<AdminJwtPayload> {
    return payload;
  }
}
