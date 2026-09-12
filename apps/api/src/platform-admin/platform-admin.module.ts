import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PlatformAdminAuthController } from './platform-admin-auth.controller';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { PlatformAdminJwtStrategy } from './strategies/platform-admin-jwt.strategy';
import { PlatformAdminJwtAuthGuard } from './guards/platform-admin-jwt-auth.guard';
import { CognitoTokenVerifierService } from './cognito-token-verifier.service';
import { AuditLogService } from './audit-log.service';
import { PlatformAdminSchoolsController } from './platform-admin-schools.controller';
import { PlatformAdminSchoolsService } from './platform-admin-schools.service';

/**
 * PlatformAdminModule — Spec 55 §7, gated entirely on the SSO/IdP vendor decision
 * (ultm8-tenant-isolation SKILL.md §3, §4). AWS Cognito confirmed directly with the
 * product owner (Decision 100, docs/decisions/POST-SPEC-55-DECISION-LOG.md — not
 * this module's own guess) — a real, separate identity realm from tenant Users, its
 * own User Pool, separate JWT issuer/secret from AuthModule's.
 *
 * SLICE 1 (Phase 25) — the auth spine: verify a Cognito ID token, map it to a
 * pre-provisioned AdminUser, issue ULTM8's own Platform Admin JWT, and a minimal
 * `/me` endpoint proving the chain works end-to-end.
 *
 * SLICE 2 (Phase 26) — the audit-log mechanism (AuditLogEntry, see this phase's own
 * 20260925000000_platform_admin_audit_log migration) plus the first real cross-
 * tenant admin business-logic endpoint it unblocks: GET /platform-admin/schools/:id
 * (read-only — see PlatformAdminSchoolsService's own header comment for why viewing
 * is the natural starting point). Also closed a gap Slice 1 had explicitly flagged
 * rather than silently carried forward: PlatformAdminJwtAuthGuard now re-checks
 * AdminUser.revokedAt on every request, not just on the TTL alone (see that guard's
 * own comment).
 *
 * Still deliberately NOT built, each its own later slice:
 *  - Any WRITE-side cross-tenant admin endpoint (editing another tenant's records,
 *    PaymentAccount credential rotation, impersonation) — each carries real,
 *    separate design questions (what exactly can be edited, how rotation actually
 *    works against Stripe Connect/secrets-manager custody, impersonation's own
 *    session semantics) beyond just "write an audit entry," not guessed at here.
 *  - Admin-invite / self-service admin-account management (a FULL_ADMIN adding a
 *    SUPPORT/BILLING_PAYMENTS_OPS teammate) — needs a real product decision on the
 *    invite UX, not guessed at.
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
      // PlatformAdminJwtAuthGuard's own per-request revokedAt check (Slice 2, added
      // once a real endpoint made the earlier "flagged, not resolved" tradeoff
      // concrete) means this TTL is no longer the sole revocation-staleness
      // mitigation either way — it now only bounds how long a genuinely still-valid
      // token can be replayed, not how long a revoked one stays trusted.
      signOptions: { expiresIn: process.env.PLATFORM_ADMIN_JWT_TTL ?? '5m' },
    }),
  ],
  controllers: [PlatformAdminAuthController, PlatformAdminSchoolsController],
  providers: [
    PlatformAdminAuthService,
    PlatformAdminJwtStrategy,
    PlatformAdminJwtAuthGuard,
    CognitoTokenVerifierService,
    AuditLogService,
    PlatformAdminSchoolsService,
  ],
})
export class PlatformAdminModule {}
