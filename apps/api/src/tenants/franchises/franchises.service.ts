import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { School } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenant-authorization.service';
import { cursorPaginate, CursorPage } from '../../common/pagination/cursor-paginate';
import { AuthService } from '../../auth/auth.service';
import { CreateFranchiseDto } from './dto/create-franchise.dto';
import { UpdateFranchiseDto } from './dto/update-franchise.dto';

/**
 * FOUND ON REVIEW, before this ever shipped: `FranchiseResponseDto`'s own header
 * comment claims `stripeMeterId`/`stripeUsagePriceId` are "deliberately not exposed
 * here" — but nothing anywhere in this file actually enforced that. Every method
 * below returned the full Prisma row straight through the controller with no
 * projection at all, so both internal Stripe correlator ids were silently present
 * in every `POST/GET/PATCH /franchises...` response body, contradicting the DTO's
 * own stated intent.
 *
 * Fixed by explicitly `select`-ing every OTHER Franchise field on every query that
 * returns a row — not Prisma's own `omit` API: a first draft used `omit:
 * { stripeMeterId: true, stripeUsagePriceId: true }`, which looked right and matches
 * Prisma's documented syntax, but failed `tsc` against this project's actually-
 * generated client (`omit` needs `previewFeatures = ["omit"]` in schema.prisma's
 * generator block for this Prisma version — confirmed absent by grepping the
 * generated client's own type definitions for a per-model `Omit` type and finding
 * none — not present here, and adding it is a broader generator change this fix
 * doesn't need to make). Verified against the actually-installed client this time,
 * not assumed from Prisma's own docs.
 */
const FRANCHISE_PUBLIC_SELECT = {
  id: true,
  name: true,
  mobileNumber: true,
  address: true,
  type: true,
  activities: true,
  facilities: true,
  defaultLanguage: true,
  defaultCurrency: true,
  description: true,
  logoUrl: true,
  bannerUrl: true,
  feeModel: true,
  flatFeeAmount: true,
  perHeadcountRate: true,
  createdAt: true,
  updatedAt: true,
  // Deliberately excluded: stripeMeterId, stripeUsagePriceId — see this
  // constant's own header comment.
} as const;

@Injectable()
export class FranchisesService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Self-service Franchise creation, creator becomes FRANCHISE_OWNER — the same
   * shape SchoolsService.create() already established for School (Decision 79),
   * confirmed directly with the product owner for Franchise too ("Same as School:
   * self-service") rather than re-derived. See that method's own comment for the
   * full rationale (self-registration RLS bootstrap pattern, atomic School+RoleGrant
   * transaction) — identical here, just against Franchise/franchiseId instead of
   * School/schoolId.
   *
   * The `franchise_tenant_isolation` RLS policy needed the exact same two-part fix
   * `school_tenant_isolation` needed in Phase 2 (Decision-log-documented CI failures:
   * 20260903000000_tenants_module_rls's WITH CHECK widening, then
   * 20260905000000_phase2_grant_and_bootstrap_fixes's USING widening for the
   * INSERT...RETURNING row-visibility requirement) — applied proactively in this
   * phase's own migration (20260920000000_franchises_module) rather than
   * rediscovered via a second CI failure, since the root cause (a brand-new tenant
   * row has no RoleGrant referencing it yet, and Postgres RLS requires RETURNING's
   * row to satisfy USING too) is identical and already fully understood.
   */
  async create(callerId: string, dto: CreateFranchiseDto) {
    const franchiseId = randomUUID();
    const roleGrantId = randomUUID();

    const franchise = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const created = await tx.franchise.create({
        data: {
          id: franchiseId,
          name: dto.name,
          mobileNumber: dto.mobileNumber,
          address: dto.address,
          type: dto.type,
          activities: dto.activities ?? [],
          facilities: dto.facilities ?? [],
          defaultLanguage: dto.defaultLanguage,
          defaultCurrency: dto.defaultCurrency,
          description: dto.description,
          logoUrl: dto.logoUrl,
          bannerUrl: dto.bannerUrl,
          feeModel: dto.feeModel,
          flatFeeAmount: dto.flatFeeAmount,
          perHeadcountRate: dto.perHeadcountRate,
        },
        select: FRANCHISE_PUBLIC_SELECT,
      });

      await tx.roleGrant.create({
        data: {
          id: roleGrantId,
          role: 'FRANCHISE_OWNER',
          userId: callerId,
          franchiseId: created.id,
          grantedById: callerId, // self-granted at creation time — there is no prior grantor
        },
      });

      return created;
    });

    // Re-mint the caller's own access token now that their FRANCHISE_OWNER grant is
    // committed — same narrow, approved exception SchoolsService.create() already
    // uses (ultm8-nestjs-module §7), called after the transaction commits for the
    // same connection-visibility reason documented on that method.
    const accessToken = await this.authService.issueAccessToken(callerId);

    return { ...franchise, accessToken };
  }

  /** Franchises visible to the caller — RLS restricts this to Franchises where the
   * caller holds an active FRANCHISE_OWNER grant (franchise_tenant_isolation,
   * migration.sql) — FRANCHISE_OWNER is the only Role value ever scoped to
   * franchiseId, so this is equivalent to "Franchises the caller owns". */
  async findAllForCaller(callerId: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate((args) => tx.franchise.findMany({ ...args, select: FRANCHISE_PUBLIC_SELECT }), cursor, limit),
    );
  }

  async findOne(callerId: string, franchiseId: string) {
    const franchise = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.franchise.findUnique({ where: { id: franchiseId }, select: FRANCHISE_PUBLIC_SELECT }),
    );
    // RLS returns null (not another tenant's row) for a Franchise outside the
    // caller's scope — same "genuine 404 and a cross-tenant-blocked read are
    // indistinguishable by design" convention as SchoolsService.findOne()
    // (ultm8-tenant-isolation §2).
    if (!franchise) {
      throw new NotFoundException('Franchise not found');
    }
    return franchise;
  }

  /** Franchise Owner only (Spec §8.2) — mirrors SchoolsService.update() exactly: no
   * separate findOne() call first, since assertFranchiseOwner's own RoleGrant lookup
   * already 403s for a nonexistent/invisible franchiseId (no grant could ever exist
   * for an id that doesn't exist).
   *
   * FOUND ON REVIEW, before this ever shipped: a first draft let `flatFeeAmount`/
   * `perHeadcountRate` be changed freely at any time (Decision 99's own self-service
   * grant). Review traced what actually happens Stripe-side and found a real,
   * silent-corruption gap: `FranchiseFeeBillingService.ensureMeterAndPrice()` creates
   * a Stripe Price ONCE and caches it forever (`Franchise.stripeUsagePriceId`) —
   * Stripe Prices are immutable, so once any School's standing Subscription
   * references it, changing `perHeadcountRate` afterward does NOTHING to what
   * Stripe actually charges, while `franchise-fee-usage-reporting`'s own
   * `usageReportPass()` keeps computing each new PENDING row's `amount` from the
   * CURRENT (now-wrong) rate — the local ledger and Stripe's real invoices would
   * permanently and silently disagree, with nothing ever reconciling them. Rather
   * than build a full rate-migration mechanism (recreate the Price, walk every
   * affected Subscription's line item onto it) with no confirmed design for it
   * (Decision 99's own "what this does NOT resolve"), this blocks the change
   * outright once billing has started for at least one School — a safe rejection,
   * not a guessed fix.
   */
  async update(callerId: string, franchiseId: string, dto: UpdateFranchiseDto) {
    await this.tenantAuth.assertFranchiseOwner(callerId, franchiseId);
    // Decision 110 (Phase 56) — a closed Franchise accepts no further writes.
    await this.tenantAuth.assertFranchiseNotArchived(callerId, franchiseId);

    // FOUND ON REVIEW: `flatFeeAmount`/`perHeadcountRate` are deliberately NOT
    // widened to nullable in UpdateFranchiseDto (see that DTO's own header
    // comment) — but `@IsOptional()` treats an explicit JSON `null` exactly
    // like an omitted field and skips `@IsInt()`/`@Min()`/`@Max()` entirely,
    // so `null` still reaches this method (`dto.flatFeeAmount` typed as
    // `number | undefined`, but nothing at the validation layer actually
    // stops a raw `null` at runtime). Without this explicit rejection, that
    // `null` would pass `!== undefined` below, skip the schoolsAlreadyBilling
    // guard as a "no-op" change when nothing is currently configured, and
    // silently clear a configured rate via `tx.franchise.update()` — exactly
    // the un-designed "clear a configured rate" transition that DTO's own
    // comment says is out of scope. Same defensive pattern
    // MembershipsService.updatePlan() already established for its own
    // not-nullable `classesIncluded` field.
    if (dto.flatFeeAmount === null || dto.perHeadcountRate === null) {
      throw new BadRequestException('flatFeeAmount/perHeadcountRate cannot be null — omit the field to leave it unchanged.');
    }

    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      if (dto.flatFeeAmount !== undefined || dto.perHeadcountRate !== undefined) {
        const current = await tx.franchise.findUniqueOrThrow({
          where: { id: franchiseId },
          select: { flatFeeAmount: true, perHeadcountRate: true },
        });
        const changingRate =
          (dto.flatFeeAmount !== undefined && dto.flatFeeAmount !== current.flatFeeAmount) ||
          (dto.perHeadcountRate !== undefined && dto.perHeadcountRate !== current.perHeadcountRate);
        if (changingRate) {
          const schoolsAlreadyBilling = await tx.school.count({
            where: { franchiseId, stripeFranchiseFeeSubscriptionId: { not: null } },
          });
          if (schoolsAlreadyBilling > 0) {
            throw new ConflictException(
              "This Franchise's fee rate cannot be changed once franchise-fee billing has started for at least one School — Stripe Prices are immutable once created, and changing the rate now would silently diverge from what Stripe actually charges. Not yet supported.",
            );
          }
        }
      }

      return tx.franchise.update({
        where: { id: franchiseId },
        data: {
          name: dto.name,
          mobileNumber: dto.mobileNumber,
          address: dto.address,
          type: dto.type,
          activities: dto.activities,
          facilities: dto.facilities,
          defaultLanguage: dto.defaultLanguage,
          defaultCurrency: dto.defaultCurrency,
          description: dto.description,
          logoUrl: dto.logoUrl,
          bannerUrl: dto.bannerUrl,
          feeModel: dto.feeModel,
          flatFeeAmount: dto.flatFeeAmount,
          perHeadcountRate: dto.perHeadcountRate,
        },
        select: FRANCHISE_PUBLIC_SELECT,
      });
    });
  }

  /**
   * Franchise Owner's own School roster (GET /franchises/{id}/schools,
   * ultm8-nestjs-module §5's confirmed TenantsModule row) — a purpose-built,
   * ownership-validated cross-tenant read, explicitly NOT an RLS escalation into
   * School-scoped tables (see `school_tenant_isolation`'s own migration.sql comment,
   * Phase 1: "Deliberately NOT extended to 'Franchise Owner sees every School under
   * their Franchise'... that's confirmed to be a purpose-built, ownership-validated
   * endpoint"). A Franchise Owner's RoleGrant is scoped to franchiseId, never
   * schoolId, so their own `ultm8_app` tenant context genuinely cannot see child
   * School rows via RLS at all — the same "caller's own context can't see it" gap
   * `school_exists()` closed for student self-enrollment, here for a full-row read
   * instead of a boolean.
   *
   * FOUND ON REVIEW (student self-enrollment, this same session): reusing
   * `PrismaDiscoveryService` for a need outside AcademiesModule is a real, previously
   * caught mistake (that service's own header comment: "ONLY AcademiesService may
   * inject this") — not repeated here. Uses a new, narrowly-scoped SECURITY DEFINER
   * function instead (`schools_for_franchise`, this phase's migration), mirroring
   * `school_exists()`'s own shape: owned by the existing `ultm8_rls_helper` role (no
   * new role needed — it already holds `GRANT SELECT ON "School"` from the student
   * self-enrollment migration), called via a parameterized `tx.$queryRaw` from INSIDE
   * the caller's own `ultm8_app` context, same as `bookings.service.ts`'s
   * `SELECT ... FOR UPDATE` precedent.
   *
   * FOUND ON REVIEW: unlike `school_exists()` (a boolean, nothing to leak),
   * `schools_for_franchise()` returns full School rows — an earlier draft trusted this
   * method's own `findOne()`+`assertFranchiseOwner()` calls as the only gate, leaving
   * the SQL function itself a bare `SELECT *` any future caller could invoke unsafely.
   * The migration's own function now takes `p_caller_id` and re-derives ownership
   * itself (BYPASSRLS, same as its existence check), so authorization is enforced at
   * the data layer, not just this one call site — see that function's own comment.
   * That makes the separate `assertFranchiseOwner()` call redundant here without
   * weakening anything (the function is now its own defense-in-depth layer, stronger
   * than the app-layer check it replaces): dropped, keeping only `findOne()` for the
   * 404-vs-nonexistent-Franchise distinction a bare empty-array result couldn't give.
   *
   * Not cursor-paginated (deliberately deviates from this codebase's own "every list
   * endpoint uses cursor pagination" convention, Decision 22) — a Franchise's own
   * School roster is a bounded administrative view (a Franchise realistically has a
   * small number of member Schools), and `cursorPaginate`'s helper operates on a
   * Prisma delegate's own `findMany`, not a raw-SQL-backed function result; adding
   * hand-rolled keyset pagination over raw SQL for a roster at this scale would be
   * real, unused complexity. `schools_for_franchise()` caps at 1000 rows as a hard
   * safety backstop for this assumption, not a substitute for real pagination if the
   * assumption ever turns out wrong — flagged for Architect review in that case.
   */
  async findSchoolsForFranchise(callerId: string, franchiseId: string): Promise<School[]> {
    await this.findOne(callerId, franchiseId); // 404s if not visible/doesn't exist

    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.$queryRaw<School[]>`SELECT * FROM schools_for_franchise(${franchiseId}, ${callerId})`,
    );
  }

  // No delete method — same reasoning as SchoolsService (general tenant offboarding
  // is [UNRESOLVED], ultm8-app-publishing §4).
}
