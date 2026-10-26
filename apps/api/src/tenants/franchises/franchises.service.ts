import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { FeeModel } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../../common/prisma/prisma-app.service';
import { PrismaJobsService } from '../../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenant-authorization.service';
import { cursorPaginate, CursorPage } from '../../common/pagination/cursor-paginate';
import { escapeLike } from '../../common/search/name-search';
import { AuthService } from '../../auth/auth.service';
import { CreateFranchiseDto, CURRENCY_CODES, FeeModelDto, LANGUAGE_CODES } from './dto/create-franchise.dto';
import { FranchiseFeeRateChangeStrategyDto, UpdateFranchiseDto } from './dto/update-franchise.dto';
import { FRANCHISE_FEE_RATE_MIGRATION_QUEUE } from '../../jobs/queue.constants';
import { FranchiseFeeRateMigrationJobData } from '../../jobs/franchise-fee-rate-migration.types';
import { addressWriteData } from '../../common/address/postal-address.dto';

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
  addressLine1: true,
  addressLine2: true,
  addressCity: true,
  addressRegion: true,
  addressPostalCode: true,
  addressCountry: true,
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
  shareBrandingWithMembers: true,
  createdAt: true,
  updatedAt: true,
  // Phase 57 — FranchiseResponseDto now types archivedAt/purgeAt/purgedAt
  // (Decision 110); selected here so the tenant-facing read genuinely returns
  // them too, not just the platform-admin one.
  archivedAt: true,
  purgeAt: true,
  purgedAt: true,
  // Deliberately excluded: stripeMeterId, stripeUsagePriceId — see this
  // constant's own header comment.
} as const;

/** One row of `franchise_member_schools()` — see FranchiseMemberSchoolResponseDto. */
export interface FranchiseMemberSchoolRow {
  id: string;
  name: string;
  businessType: string | null;
  logoUrl: string | null;
  franchiseFeeSubscriptionStatus: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | null;
  archivedAt: Date | null;
  createdAt: Date;
}

/** A School "already being billed" — it holds a live franchise-fee subscription.
 * Decision 337: a subscription Stripe has since cancelled no longer counts, and
 * neither does a closed School (its subscription is cancelled when it closes). */
const BILLING_SCHOOL_WHERE = {
  stripeFranchiseFeeSubscriptionId: { not: null },
  OR: [{ franchiseFeeSubscriptionStatus: null }, { franchiseFeeSubscriptionStatus: { not: 'CANCELED' as const } }],
  archivedAt: null,
};

@Injectable()
export class FranchisesService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly authService: AuthService,
    @InjectQueue(FRANCHISE_FEE_RATE_MIGRATION_QUEUE) private readonly rateMigrationQueue: Queue,
    private readonly prismaJobs: PrismaJobsService,
  ) {}

  /**
   * How many of this Franchise's Schools are already being billed. Decision 337 —
   * counted on the jobs connection, not the caller's: School's RLS shows a row only
   * to someone with a role AT that School, so a Franchise Owner's own context sees
   * none of its member Schools once they have an owner (every real School does).
   * Counted that way, this was always 0 in practice, so the rate-change prompt and
   * the fee-model lock never fired. Callers check Franchise ownership first; only
   * a number leaves this method.
   */
  private countSchoolsAlreadyBilling(franchiseId: string): Promise<number> {
    return this.prismaJobs.school.count({ where: { franchiseId, ...BILLING_SCHOOL_WHERE } });
  }

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
          ...addressWriteData(dto),
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
          shareBrandingWithMembers: dto.shareBrandingWithMembers,
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
   * franchiseId, so this is equivalent to "Franchises the caller owns".
   *
   * `feeModel`/`activity` — additive, optional filters (School Portal's Franchises
   * page Fee model / Activity filters, FranchisesQueryDto). Both omitted behaves
   * exactly as before either filter existed.
   *
   * Decision 278 — `search` (header Global Search): case-insensitive substring on
   * `name`, one more condition on the same RLS-scoped query; never widens it.
   * `excludeArchived` (default false, so the Franchises page still lists closed
   * Franchises as before) leaves archived Franchises out — the search box asks
   * for it so a closed Franchise can't take one of its few result slots. */
  async findAllForCaller(
    callerId: string,
    cursor?: string,
    limit?: number,
    feeModel?: FeeModelDto,
    activity?: string,
    search?: string,
    excludeArchived?: boolean,
  ): Promise<CursorPage<{ id: string }>> {
    const activityTerm = activity?.trim();
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      // Decision 337 (F11) — the Activity filter ignores capitals, like the header
      // search. Prisma's `has` is case-sensitive, so the matching ids come from a
      // raw query run in the same RLS-scoped transaction (it can only ever see
      // the caller's own Franchises, same as the findMany below).
      const activityIds = activityTerm
        ? (
            await tx.$queryRaw<Array<{ id: string }>>`
              SELECT id FROM "Franchise"
              WHERE EXISTS (SELECT 1 FROM unnest(activities) a WHERE lower(a) = lower(${activityTerm}))`
          ).map((r) => r.id)
        : undefined;
      return cursorPaginate(
        (args) =>
          tx.franchise.findMany({
            ...args,
            where: {
              ...(feeModel ? { feeModel } : {}),
              ...(activityIds ? { id: { in: activityIds } } : {}),
              // Decision 278 — header Global Search, same idiom as ClassesService's `search`.
              ...(search ? { name: { contains: escapeLike(search), mode: 'insensitive' } } : {}),
              ...(excludeArchived ? { archivedAt: null } : {}),
            },
            select: FRANCHISE_PUBLIC_SELECT,
          }),
        cursor,
        limit,
      );
    });
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
   * permanently and silently disagree, with nothing ever reconciling them. That
   * first draft blocked the change outright once billing had started for at least
   * one School — a safe rejection, not a guessed fix, but deferred rather than
   * decided against (Decision 99's own "what this does NOT resolve").
   *
   * RESOLVED (Decision 99's own follow-up): `feeRateChangeStrategy` below replaces
   * that outright rejection with a real migration — see
   * franchise-fee-rate-migration.processor.ts's own header comment for the full
   * Stripe-mechanics account (FLAT vs. PER_HEADCOUNT are NOT symmetric; disclosed
   * to the Franchise Owner via the BadRequestException below, confirmed with the
   * product owner before building, not silently picked).
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
    // Decision 337 (F20) — same gap for the other not-nullable fields: an
    // explicit `null` slipped past `@IsOptional()` and reached Prisma, which
    // answered with a 500.
    const nullable = dto as unknown as Record<string, unknown>;
    if (nullable.name === null) throw new BadRequestException("Franchise name can't be empty.");
    if (nullable.feeModel === null) throw new BadRequestException('feeModel cannot be null — omit the field to leave it unchanged.');
    if (nullable.activities === null || nullable.facilities === null) {
      throw new BadRequestException('activities/facilities cannot be null — send an empty list to clear them.');
    }

    let rateChangeContext:
      | {
          feeModel: FeeModel;
          oldFlatFeeAmount: number | null;
          newFlatFeeAmount: number | null;
          oldPerHeadcountRate: number | null;
          newPerHeadcountRate: number | null;
          strategy: FranchiseFeeRateChangeStrategyDto;
          affectedSchoolCount: number;
        }
      | undefined;

    const updated = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const current = await tx.franchise.findUniqueOrThrow({
        where: { id: franchiseId },
        select: { feeModel: true, flatFeeAmount: true, perHeadcountRate: true, defaultLanguage: true, defaultCurrency: true },
      });

      // Decision 337 (F21) — language/currency must come from the same lists the
      // form's pickers use. An unchanged legacy free-text value is let through, so
      // an older Franchise can still be edited without re-picking it first.
      if (dto.defaultLanguage != null && dto.defaultLanguage !== current.defaultLanguage && !LANGUAGE_CODES.includes(dto.defaultLanguage)) {
        throw new BadRequestException('defaultLanguage must be one of the supported language codes.');
      }
      if (dto.defaultCurrency != null && dto.defaultCurrency !== current.defaultCurrency && !CURRENCY_CODES.includes(dto.defaultCurrency)) {
        throw new BadRequestException('defaultCurrency must be one of the supported currency codes.');
      }

      const changingRate =
        (dto.flatFeeAmount !== undefined && dto.flatFeeAmount !== current.flatFeeAmount) ||
        (dto.perHeadcountRate !== undefined && dto.perHeadcountRate !== current.perHeadcountRate);
      const changingFeeModel = dto.feeModel !== undefined && dto.feeModel !== current.feeModel;
      const schoolsAlreadyBilling =
        changingRate || changingFeeModel ? await this.countSchoolsAlreadyBilling(franchiseId) : 0;

      // Decision 337 (F1) — a fee-model switch can't be carried over to Schools that
      // are already billing: their Stripe subscriptions hold a flat Price or a
      // metered one, and the monthly job would start treating them as the other
      // kind. Blocked rather than migrated (product owner's choice, Q3).
      if (changingFeeModel && schoolsAlreadyBilling > 0) {
        throw new BadRequestException(
          `This Franchise has ${schoolsAlreadyBilling} School(s) already being billed, so its fee model can't be changed. Changing the fee amount is still possible.`,
        );
      }

      if (changingRate) {
        // A brand-new/never-billed Franchise has nothing to migrate — no
        // decision is required, and no FranchiseFeeRateChange row is created;
        // the rate simply changes, same as any other field edit. Same
        // "nothing to migrate" shape MembershipsService.updatePlan() already
        // establishes for a plan with zero active subscribers.
        if (schoolsAlreadyBilling > 0) {
          if (!dto.feeRateChangeStrategy) {
            throw new BadRequestException(
              `This Franchise has ${schoolsAlreadyBilling} School(s) already being billed at the current rate — choose feeRateChangeStrategy ("MIGRATE_NEXT_CYCLE" or "MIGRATE_IMMEDIATE") before changing it. MIGRATE_IMMEDIATE on a PER_HEADCOUNT Franchise re-rates the ENTIRE current billing period's already-accrued usage at the new rate, not just the days remaining — a real Stripe metered-billing constraint, not a choice; disclosed here rather than hidden.`,
            );
          }
          rateChangeContext = {
            feeModel: current.feeModel,
            oldFlatFeeAmount: current.flatFeeAmount,
            newFlatFeeAmount: dto.flatFeeAmount ?? current.flatFeeAmount,
            oldPerHeadcountRate: current.perHeadcountRate,
            newPerHeadcountRate: dto.perHeadcountRate ?? current.perHeadcountRate,
            strategy: dto.feeRateChangeStrategy,
            affectedSchoolCount: schoolsAlreadyBilling,
          };
        }
      } else if (dto.feeRateChangeStrategy) {
        // Same "a caller-supplied value with no effect is a caller mistake
        // worth surfacing" discipline MembershipsService.updatePlan() already
        // applies to its own analogous priceChangeStrategy field.
        throw new BadRequestException("feeRateChangeStrategy was provided but this edit does not change flatFeeAmount/perHeadcountRate — omit it.");
      }

      return tx.franchise.update({
        where: { id: franchiseId },
        data: {
          name: dto.name,
          mobileNumber: dto.mobileNumber,
          ...addressWriteData(dto),
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
          shareBrandingWithMembers: dto.shareBrandingWithMembers,
        },
        select: FRANCHISE_PUBLIC_SELECT,
      });
    });

    if (rateChangeContext) {
      await this.recordFeeRateChangeDecision(callerId, franchiseId, rateChangeContext);
    }

    return updated;
  }

  /**
   * Decision 99's own follow-up — records the auditable decision row and always
   * enqueues the background migration job (franchise-fee-rate-migration.processor.ts).
   * Unlike MembershipsService's analogous recordPriceChangeDecision() (where
   * GRANDFATHER resolves synchronously, nothing further to do), BOTH strategies
   * here need real Stripe work — even MIGRATE_NEXT_CYCLE requires creating a
   * replacement Price and, for PER_HEADCOUNT, a deferred swap — so there is no
   * synchronous-complete shortcut.
   */
  private async recordFeeRateChangeDecision(
    callerId: string,
    franchiseId: string,
    ctx: {
      feeModel: FeeModel;
      oldFlatFeeAmount: number | null;
      newFlatFeeAmount: number | null;
      oldPerHeadcountRate: number | null;
      newPerHeadcountRate: number | null;
      strategy: FranchiseFeeRateChangeStrategyDto;
      affectedSchoolCount: number;
    },
  ): Promise<void> {
    const id = randomUUID();
    await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.franchiseFeeRateChange.create({
        data: {
          id,
          franchiseId,
          feeModel: ctx.feeModel,
          oldFlatFeeAmount: ctx.oldFlatFeeAmount,
          newFlatFeeAmount: ctx.newFlatFeeAmount,
          oldPerHeadcountRate: ctx.oldPerHeadcountRate,
          newPerHeadcountRate: ctx.newPerHeadcountRate,
          strategy: ctx.strategy,
          decidedById: callerId,
          affectedSchoolCount: ctx.affectedSchoolCount,
          status: 'PENDING',
        },
      }),
    );
    await this.rateMigrationQueue.add(
      'migrate',
      { rateChangeId: id } satisfies FranchiseFeeRateMigrationJobData,
      { jobId: id, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );
  }

  /**
   * GET /franchises/{id}/billing-status (Decision 99's own follow-up) —
   * FranchiseFormModal queries this BEFORE submitting a rate change, to know
   * whether `feeRateChangeStrategy` will be required, same "query, don't
   * guess" precedent `MembershipsService.getActiveMemberCount`'s own
   * GET /membership-plans/{id}/active-count already establishes. Mirrors the
   * exact `schoolsAlreadyBilling` count `update()` computes itself.
   */
  async getBillingStatus(callerId: string, franchiseId: string): Promise<{ schoolsAlreadyBillingCount: number }> {
    await this.tenantAuth.assertFranchiseOwner(callerId, franchiseId);
    const schoolsAlreadyBillingCount = await this.countSchoolsAlreadyBilling(franchiseId);
    return { schoolsAlreadyBillingCount };
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
  async findSchoolsForFranchise(callerId: string, franchiseId: string): Promise<FranchiseMemberSchoolRow[]> {
    await this.findOne(callerId, franchiseId); // 404s if not visible/doesn't exist

    // Decision 337 (F2) — `franchise_member_schools()` replaced the earlier
    // `schools_for_franchise()`, which returned whole School rows (join code and
    // Stripe ids included). The new function returns only the roster columns and
    // reads the caller from `app.current_user_id` instead of an argument
    // (migration 20261129000000_franchise_review_fixes).
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.$queryRaw<FranchiseMemberSchoolRow[]>`SELECT * FROM franchise_member_schools(${franchiseId})`,
    );
  }

  // No delete method — same reasoning as SchoolsService (general tenant offboarding
  // is [UNRESOLVED], ultm8-app-publishing §4).
}
