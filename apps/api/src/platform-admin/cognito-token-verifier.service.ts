import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

export interface VerifiedCognitoIdToken {
  sub: string;
  email: string;
}

/**
 * Thin wrapper around `aws-jwt-verify`'s `CognitoJwtVerifier` — same "warn on missing
 * config, don't throw at construction, fail on first actual use" convention
 * StripeClientService/TwilioVerifyService/PrismaAppService already established for
 * every other unconfigured external dependency in this codebase.
 *
 * Verifies the ID token specifically (`tokenUse: 'id'`), not the access token —
 * Cognito's access token carries no `email` claim by default, and the JWT this
 * module issues (AdminJwtPayload) carries `email` through for its own consumers,
 * even though PlatformAdminAuthService's own AdminUser lookup is keyed on `sub`
 * alone, not email (FOUND ON REVIEW: an earlier version of this comment claimed
 * email was needed for "the bootstrap/first-login-match path" — no such path
 * exists in this codebase; lookup-by-sub-only is the correct, and only, matching
 * behavior here). The frontend obtains this ID token directly from Cognito's own
 * token endpoint via the standard Hosted-UI Authorization-Code-with-PKCE flow — this backend never
 * participates in the OAuth redirect/code-exchange itself, only in verifying the
 * token that flow produces. Verification (signature against the User Pool's own
 * JWKS, `iss`/`aud`/`token_use`/expiry) all happens inside `aws-jwt-verify` — this
 * class does not re-implement any of it.
 *
 * Deliberately its own injectable class, not inlined into PlatformAdminAuthService —
 * lets e2e tests substitute a stub verifier via NestJS's `overrideProvider` (no real
 * Cognito User Pool reachable in CI) while still exercising this module's OWN logic
 * (the AdminUser lookup / revokedAt check / JWT issuance chain) for real, rather than
 * leaving the entire endpoint untested the way this codebase's Stripe call sites are
 * (see franchise-fees.e2e-spec.ts's own header comment) — unlike a Stripe charge,
 * verifying-then-mapping-to-a-user IS this endpoint's actual point, not a side effect
 * of it.
 */
@Injectable()
export class CognitoTokenVerifierService {
  private readonly logger = new Logger(CognitoTokenVerifierService.name);
  private readonly verifier: ReturnType<typeof CognitoJwtVerifier.create> | null;

  constructor() {
    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_CLIENT_ID;
    if (!userPoolId || !clientId) {
      this.logger.warn(
        'COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID are not set — Platform Admin token verification will fail until they are.',
      );
      this.verifier = null;
      return;
    }
    this.verifier = CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: 'id',
      clientId,
    });
  }

  async verify(idToken: string): Promise<VerifiedCognitoIdToken> {
    if (!this.verifier) {
      throw new ServiceUnavailableException('Platform Admin authentication is not fully configured.');
    }
    // aws-jwt-verify throws (JwtInvalidSignatureError / JwtExpiredError / etc.) on any
    // failure — PlatformAdminAuthService lets that surface as a generic 401 rather
    // than distinguishing failure reasons back to the caller, same "don't leak which
    // part of validation failed" posture LoginAttemptTracker already takes for
    // customer login.
    const payload = await this.verifier.verify(idToken);
    return { sub: payload.sub, email: String(payload.email ?? '') };
  }
}
