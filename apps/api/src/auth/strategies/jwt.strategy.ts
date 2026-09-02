import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * Validates the access token and hands back its claims as `req.user`. 15-minute
 * access-token TTL for customer identities is confirmed (Spec §8.3) — configured via
 * JWT_ACCESS_TTL in AuthModule's JwtModule.register(), not here.
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
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    return payload;
  }
}
