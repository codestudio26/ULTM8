import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PlatformAdminAuthController } from './platform-admin-auth.controller';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { PlatformAdminJwtStrategy } from './strategies/platform-admin-jwt.strategy';
import { CognitoTokenVerifierService } from './cognito-token-verifier.service';

/**
 * PlatformAdminModule — Spec 55 §7, gated entirely on the SSO/IdP vendor decision
 * (ultm8-tenant-isolation SKILL.md §3, §4). AWS Cognito confirmed directly with the
 * product owner (Decision 100, docs/decisions/POST-SPEC-55-DECISION-LOG.md — not
 * this module's own guess) — a real, separate identity realm from tenant Users, its
 * own User Pool, separate JWT issuer/secret from AuthModule's.
 *
 * SLICE 1 ONLY — the auth spine: verify a Cognito ID token, map it to a
 * pre-provisioned AdminUser, issue ULTM8's own Platform Admin JWT, and a minimal
 * `/me` endpoint proving the chain works end-to-end. Deliberately does NOT include
 * yet, each its own later slice:
 *  - Any actual cross-tenant admin business-logic endpoint (viewing/editing another
 *    tenant's records, PaymentAccount credential rotation, impersonation) — every one
 *    of these needs the immutable audit-log write ultm8-tenant-isolation SKILL.md §3
 *    requires ("every Platform Admin action that touches tenant data... written to an
 *    immutable audit log"), which doesn't exist yet and isn't invented here.
 *  - Admin-invite / self-service admin-account management (a FULL_ADMIN adding a
 *    SUPPORT/BILLING_PAYMENTS_OPS teammate) — needs a real product decision on the
 *    invite UX (see this phase's own kickoff discussion), not guessed at.
 *  - SubscriptionPlansModule / TranslationsModule — sit behind this module's own
 *    guard chain by confirmed design, both still separate, unbuilt modules.
 *
 * JwtModule.register() here is deliberately separate from AuthModule's own — neither
 * is registered `isGlobal`, so each module's `JwtService` is independently configured
 * (AuthModule's against JWT_ACCESS_SECRET, this one against
 * PLATFORM_ADMIN_JWT_SECRET) with no risk of one overriding the other.
 */
@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.PLATFORM_ADMIN_JWT_SECRET,
      // Shorter than the tenant realm's 15-minute default (JWT_ACCESS_TTL, itself
      // spec-confirmed — Spec §8.3). This 5-minute figure is NOT spec-confirmed or
      // product-owner-approved the way that one is — a Developer-level engineering
      // placeholder (Decision 100, docs/decisions/POST-SPEC-55-DECISION-LOG.md),
      // deliberately narrower than the tenant default given this is the
      // highest-privilege identity boundary in the system (ultm8-tenant-isolation
      // SKILL.md §3), open to explicit revision rather than treated as settled.
      //
      // FOUND ON REVIEW: neither PlatformAdminJwtStrategy nor
      // PlatformAdminJwtAuthGuard re-checks AdminUser.revokedAt on every request —
      // only signature/expiry, mirroring the tenant JwtStrategy's own identical
      // pattern. A revoked admin's still-unexpired token is trusted for up to this
      // TTL; GET /platform-admin/auth/me happens to re-fetch from the DB (it needs
      // `name`, which isn't in the JWT), incidentally re-checking revocation too, but
      // that's a side effect of needing that field, not a guarantee every future
      // endpoint gets automatically. A Slice 2+ endpoint that only does
      // `@UseGuards(PlatformAdminJwtAuthGuard)` inherits the TTL as its sole
      // revocation-staleness mitigation — worth an explicit decision (a shorter TTL
      // still, or a real per-request DB check added to the guard itself) before this
      // module's surface grows much further, not silently assumed either way.
      signOptions: { expiresIn: process.env.PLATFORM_ADMIN_JWT_TTL ?? '5m' },
    }),
  ],
  controllers: [PlatformAdminAuthController],
  providers: [PlatformAdminAuthService, PlatformAdminJwtStrategy, CognitoTokenVerifierService],
})
export class PlatformAdminModule {}
