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
import { PlatformAdminFranchisesController } from './platform-admin-franchises.controller';
import { PlatformAdminFranchisesService } from './platform-admin-franchises.service';
import { PlatformAdminUsersController } from './platform-admin-users.controller';
import { PlatformAdminUsersService } from './platform-admin-users.service';
import { PlatformAdminPaymentAccountsController } from './platform-admin-payment-accounts.controller';
import { PlatformAdminPaymentAccountsService } from './platform-admin-payment-accounts.service';
import { PlatformAdminImpersonationController } from './platform-admin-impersonation.controller';
import { PlatformAdminImpersonationService } from './platform-admin-impersonation.service';
import { PaymentsModule } from '../payments/payments.module';
import { AuthModule } from '../auth/auth.module';

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
 * SLICE 3 (Phase 27) — GET /platform-admin/franchises/:id, extending the same
 * cross-tenant-read pattern to a second entity, proving Slice 2's own
 * infrastructure (the audit-log mechanism, the ultm8_platform_admin role) actually
 * generalizes rather than being School-specific — no new role, no new module
 * plumbing, just the same recipe applied again (see
 * 20260926000000_platform_admin_franchise_read).
 *
 * SLICE 4 (Phase 28) — the first WRITE-side endpoint: POST/GET
 * /platform-admin/admin-users, a FULL_ADMIN-run successor to
 * scripts/bootstrap-admin-user.ts for every admin after the very first one.
 * This was never actually blocked on a product decision the way the header
 * comment used to claim — the mechanics were already fully reasoned through
 * during Slice 1's own kickoff (identity via Cognito and authorization via this
 * record are two separate steps, same design the bootstrap script's own header
 * comment documents) — deferred purely for slice-size discipline, not genuine
 * ambiguity. Both routes are FULL_ADMIN-only, the one subRole restriction the
 * spec actually confirms (SKILL.md §3).
 *
 * SLICE 5 (Phase 29) — DELETE /platform-admin/admin-users/:id: the other half
 * of the AdminUser lifecycle Slice 4 started, confirmed by Spec §4.4 ("access
 * revoked immediately" on offboarding). Soft-revoke via `revokedAt`, same
 * idempotent shape RoleGrantsService.revoke() already established on the
 * tenant side, plus one lockout safeguard with no tenant-side analogue —
 * revoking the last active FULL_ADMIN is refused, since assertFullAdmin()
 * gates every write in this service including revoke itself (see
 * PlatformAdminUsersService's own header comment for the full reasoning).
 *
 * SLICE 6 (Phase 30) — GET .../payment-account (School- and Franchise-scoped): a
 * third cross-tenant read entity, and the FIRST read in this module restricted to
 * a specific subRole rather than opened to all three tiers. Confirmed directly by
 * ultm8-tenant-isolation SKILL.md §3's own split: Billing/Payments Ops "can view
 * PaymentAccount configuration status ... but never sees a decrypted secret" —
 * Support's own bullet explicitly excludes "a Stripe Connected Account id," and
 * nothing confirms Support gets broader PaymentAccount visibility, so this read is
 * BILLING_PAYMENTS_OPS + FULL_ADMIN only (see
 * PlatformAdminPaymentAccountsService's own header comment). Response excludes
 * `stripeConnectedAccountId` entirely, at both the DB-grant and DTO layer.
 *
 * SLICE 7 (Phase 35) — POST .../payment-accounts/:id/rotate-credential: the WRITE
 * half of Billing/Payments Ops's own confirmed capability, resolved without
 * guessing by connecting two already-confirmed pieces rather than inventing a new
 * mechanism — Spec §3.2's own literal wording ("the engineer initiates a new
 * Stripe Connect onboarding/rotation flow") and PaymentsService.
 * initiateConnectOnboarding()'s own already-built, already-tested "re-request a
 * fresh Account Link against an existing Connected Account" behavior (see
 * PlatformAdminPaymentAccountsService.initiateCredentialRotation()'s own header
 * comment for the full reasoning, including what's deliberately still NOT built:
 * step-up MFA for this action, and rotation for the unbuilt AWS Secrets Manager
 * fallback path).
 *
 * SLICE 8 (Phase 43) — POST .../impersonation-sessions: Support-tier
 * impersonation, resolved read-only by Decision 102 (docs/decisions/POST-SPEC-55-
 * DECISION-LOG.md, resolved directly with the user) — the one remaining piece
 * Decision 100's own "not built in this phase" list named. See
 * PlatformAdminImpersonationService's own header comment for the mechanism (a
 * genuine tenant-realm JWT, verified by AuthModule's own JwtStrategy, which
 * enforces read-only globally) and its known, flagged limitation (only the
 * session START is audit-logged, not every read taken during it).
 *
 * PHASE 49 — TranslationsModule now built as the separate module this comment
 * already called for: `apps/api/src/translations/`, importing this module for
 * exactly two things (see this module's own `exports` line below) —
 * `PlatformAdminJwtAuthGuard` for `platform-admin/translations`'s own guard chain,
 * and `AuditLogService` for the same "every Platform Admin write is audited"
 * discipline Slice 4/5's own AdminUser create/revoke already established. This is
 * the first time anything outside this module has needed to reuse a piece of it —
 * `exports` was empty before this phase.
 *
 * Still deliberately NOT built, each its own later slice:
 *  - General tenant-data EDITS (as opposed to the impersonation Slice 8 just
 *    shipped) — still genuinely unscoped, not just unbuilt: no field, entity, or
 *    sub-role tier is named anywhere in Spec 55 or the decision log for it,
 *    confirmed by direct research (see the ULTM8 Roadmap artifact's own §04 for
 *    the exact open question). Slice 4/5's own admin-user create/revoke is NOT
 *    this category — it's Platform Admin's own internal roster, not a tenant's
 *    data.
 *  - SubscriptionPlansModule — sits behind this module's own guard chain by
 *    confirmed design, same shape TranslationsModule (Phase 49) now uses; still a
 *    separate, unbuilt module, additionally blocked on the `[UNRESOLVED]`
 *    Franchise-Subscription-Plan billing-direction question (domain-rules §2) —
 *    unlike Translations, not just "never picked up."
 *  - `apps/platform-admin`'s own authoring UI for Translations — Phase 49 is
 *    backend only, matching this codebase's established backend-then-UI split
 *    (e.g. CurriculumModule was Phase 44 backend / Phase 45 UI).
 *
 * JwtModule.register() here is deliberately separate from AuthModule's own — neither
 * is registered `isGlobal`, so each module's `JwtService` is independently configured
 * (AuthModule's against JWT_ACCESS_SECRET, this one against
 * PLATFORM_ADMIN_JWT_SECRET) with no risk of one overriding the other. Slice 8
 * (Phase 43) imports AuthModule directly (already exports AuthService — see that
 * module's own `exports`) specifically so PlatformAdminImpersonationService can
 * call AuthService.issueImpersonationToken(), which signs against
 * JWT_ACCESS_SECRET via AuthModule's own JwtService instance, not this module's —
 * the minted token is a TENANT-realm token, deliberately not a
 * PLATFORM_ADMIN_JWT_SECRET one.
 */
@Module({
  imports: [
    PassportModule,
    PaymentsModule, // for StripeClientService — see Slice 7's own header comment
    AuthModule, // for AuthService.issueImpersonationToken() — see Slice 8's own header comment
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
  controllers: [
    PlatformAdminAuthController,
    PlatformAdminSchoolsController,
    PlatformAdminFranchisesController,
    PlatformAdminUsersController,
    PlatformAdminPaymentAccountsController,
    PlatformAdminImpersonationController,
  ],
  providers: [
    PlatformAdminAuthService,
    PlatformAdminJwtStrategy,
    PlatformAdminJwtAuthGuard,
    CognitoTokenVerifierService,
    AuditLogService,
    PlatformAdminSchoolsService,
    PlatformAdminFranchisesService,
    PlatformAdminUsersService,
    PlatformAdminPaymentAccountsService,
    PlatformAdminImpersonationService,
  ],
  // Phase 49 — first-ever export from this module. PlatformAdminJwtAuthGuard is
  // used via @UseGuards() in TranslationsModule's own PlatformAdminTranslationsController,
  // which requires ALSO exporting PlatformAdminAuthService (the guard's own
  // constructor dependency) — a guard consumed this way gets a fresh,
  // importing-module-scoped instance, not the singleton already living in this
  // module, so its own dependency must be independently resolvable from the
  // importing module's DI graph too. See TranslationsModule's own header comment
  // for the full account, verified against the installed @nestjs/core source
  // before relying on it. AuditLogService has no such issue (plain constructor
  // injection only) — exported for TranslationsService to reuse the same "every
  // Platform Admin write is audited" mechanism this module's own AdminUser
  // create/revoke already uses.
  exports: [PlatformAdminJwtAuthGuard, PlatformAdminAuthService, AuditLogService],
})
export class PlatformAdminModule {}
