import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../../common/prisma/prisma-auth.service';
import { resolveUserNames } from '../../common/prisma/resolve-user-names';
import { PrismaJobsService } from '../../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenant-authorization.service';
import { cursorPaginate, CursorPage } from '../../common/pagination/cursor-paginate';
import { AuthService } from '../../auth/auth.service';
import { GuardiansService } from '../../guardians/guardians.service';
import { StripeClientService } from '../../payments/stripe-client.service';
import { CreateSchoolDto } from './dto/create-school.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { JoinSchoolDto } from './dto/join-school.dto';
import { SetHomeBranchDto } from './dto/home-branch.dto';
import { StudentRosterStatusDto, StudentStatusDto } from './dto/student-roster-query.dto';

@Injectable()
export class SchoolsService {
  private readonly logger = new Logger(SchoolsService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly authService: AuthService,
    private readonly guardiansService: GuardiansService,
    private readonly stripeClient: StripeClientService,
  ) {}

  /**
   * Self-service School creation (explicitly confirmed with the product owner for
   * Phase 2 — not stated anywhere in Spec 55/domain-rules/the decision log; the only
   * prior evidence was the `createSchoolProfile` Figma screen, [OBSERVED IN DESIGNS]
   * only). Any authenticated User may create a School and is granted
   * SCHOOL_OWNER_MANAGER on it atomically, in the same transaction as the School row
   * itself — this is the same self-registration RLS bootstrap pattern already used by
   * AuthService.register() (School's RLS WITH CHECK for INSERT only requires an
   * established app.current_user_id context; the RoleGrant's own INSERT is covered by
   * the existing rolegrant_self_only policy, since the grantee is the caller).
   *
   * franchiseId is never accepted here — see CreateSchoolDto's header comment.
   */
  async create(callerId: string, dto: CreateSchoolDto) {
    const schoolId = randomUUID();
    const roleGrantId = randomUUID();

    const school = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const created = await tx.school.create({
        data: {
          id: schoolId,
          name: dto.name,
          mobileNumber: dto.mobileNumber,
          address: dto.address,
          businessType: dto.businessType,
          activities: dto.activities ?? [],
          facilities: dto.facilities ?? [],
          ranksToggle: dto.ranksToggle ?? false,
          defaultLanguage: dto.defaultLanguage,
          defaultCurrency: dto.defaultCurrency,
          timezone: dto.timezone,
          description: dto.description,
          logoUrl: dto.logoUrl,
          bannerUrl: dto.bannerUrl,
          classCancellationPolicy: dto.classCancellationPolicy,
          waitlistClaimWindowMinutes: dto.waitlistClaimWindowMinutes,
        },
      });

      await tx.roleGrant.create({
        data: {
          id: roleGrantId,
          role: 'SCHOOL_OWNER_MANAGER',
          userId: callerId,
          schoolId: created.id,
          grantedById: callerId, // self-granted at creation time — there is no prior grantor
        },
      });

      return created;
    });

    // Re-mint the caller's own access token now that their SCHOOL_OWNER_MANAGER grant
    // is committed, so the frontend can swap it in immediately instead of forcing a
    // log-out/back-in (ultm8-nestjs-module §7's narrow, approved exception — scoped
    // deliberately to this one case; see AuthService.issueAccessToken()'s own header
    // comment). Called AFTER the transaction above commits, not from inside it —
    // issueAccessToken() opens its own transaction, and nesting one inside the still-
    // open one above would try to read the RoleGrant row before it's actually
    // committed, from a separate connection that can't see it yet.
    const accessToken = await this.authService.issueAccessToken(callerId);

    return { ...school, accessToken };
  }

  /**
   * Self-service Student enrollment — a caller becomes a STUDENT at an EXISTING
   * School, discovered via AcademiesModule (Phase 14). Not spec-confirmed as a
   * named endpoint anywhere — a genuine, previously-missing gap surfaced during
   * Phase 15's own review: no path anywhere in this codebase ever created a
   * STUDENT RoleGrant (grepped every call site to confirm), so no real Student
   * could actually join a School at all. Decided directly with the product
   * owner (see Decision 96, docs/decisions/POST-SPEC-55-DECISION-LOG.md) as
   * self-service, the same shape `create()` above already uses for School
   * Owner — not an invite-only flow (which would leave AcademiesModule's own
   * discovery feature with nowhere to lead), and not gated behind a
   * Membership purchase (a Trial Membership already exists as a first-class
   * concept, and nothing confirms a browsing caller must pay before joining).
   *
   * Originally built (Decision 96) for only an ADULT caller joining on their
   * OWN behalf — Guardian-on-behalf-of enrollment was explicitly named as
   * OUT OF SCOPE in that decision's own "what this does not resolve"
   * section. Phase 38 closed that gap: `dto.studentId` is the same
   * on-behalf-of shape `SignWaiverDto` (Phase 37) already established.
   * `isGuardianAction` asserts an active GuardianLink instead of relying on
   * the caller's own tenant context, then runs the existence check AND the
   * RoleGrant write under the TARGET Student's own tenant context — for an
   * ordinary self-join that's a no-op (studentId === callerId already), but
   * for a Guardian it's load-bearing for the exact same reason
   * WaiversService.sign()'s own comment gives: `rolegrant_self_only` admits
   * a caller writing a row under their own userId, and a Guardian has no
   * userId-equals-target row to write under their OWN context. Decision 96's
   * own text pointed at the `ultm8_jobs` cascade `withdrawConsent()` uses as
   * the closest precedent for "a Guardian writing into a minor's own rows" —
   * this uses the simpler, more directly analogous target-tenant-context
   * substitution instead (Booking's own Staff-on-behalf-of write, and this
   * exact codebase's own `createMinor()` `withMultiTenantContext` bootstrap),
   * since a single RoleGrant INSERT needs no second context switch the way
   * withdrawConsent()'s multi-row cascade did.
   *
   * FOUND ON REVIEW, before this ever shipped — the first draft's mechanism
   * was a real mistake: it reused `PrismaDiscoveryService` (Phase 14,
   * provisioned specifically and exclusively for AcademiesModule — see that
   * service's own header comment: "ONLY AcademiesService may inject this")
   * for its own School-existence check. Rewritten to use `school_exists()`
   * instead — a `SECURITY DEFINER` function mirroring `school_has_any_role_
   * grant`'s own established shape (20260906000000), owned by the existing
   * `ultm8_rls_helper` role (no new role needed), called via a parameterized
   * `tx.$queryRaw` from INSIDE the caller's own `ultm8_app` context — the
   * same raw-query pattern `bookings.service.ts`/`waitlist.service.ts`
   * already use for `SELECT ... FOR UPDATE`. Zero coupling to
   * AcademiesModule's own policies; see the Phase student-self-enrollment
   * migration's own header comment and Decision 96 for the full account.
   *
   * The existence check and the RoleGrant write both run inside ONE
   * `withTenantContext` transaction — the write itself needs no bypass at
   * all (`rolegrant_self_only` already admits a caller writing their OWN
   * userId, regardless of School-level access); only the existence check
   * needed a mechanism that could see a School the caller holds no grant at.
   * Idempotency is enforced by `RoleGrant_one_active_student_per_school` (a
   * real DB constraint, not a separate check-then-insert query that a
   * concurrent request could race past) — the create is attempted directly
   * and a unique-constraint violation (P2002) becomes the 409, the same
   * "atomic create() + caught P2002" pattern already established elsewhere
   * in this codebase (e.g. Waiver creation dedup).
   *
   * v1.2 backend backlog ("Invite a Student") added a SECOND on-behalf-of
   * case, Staff enrolling an existing-but-unenrolled person at their own
   * School (find-then-confirm, `GET .../role-grants/invite-candidate`
   * ahead of this call — the account-creation half of the original mockup
   * was explicitly removed by the product owner, 28 Sep; StaffPage's own
   * Instructor/Branch Staff invite flow is the shape this mirrors). Same
   * `dto.studentId` on-behalf-of field Phase 38 already established — there
   * is no separate DTO field to distinguish "Guardian" from "Staff" caller,
   * so which one applies is DISCOVERED, not declared: try the School-Owner
   * gate RoleGrantsService.create()/StaffPage's own invite flow already use
   * for this exact kind of action first (this page lives behind the
   * School-Owner-only part of the portal, same as StaffPage), and only fall
   * back to `assertGuardianOfStudent` if the caller doesn't hold that grant
   * — the same "try one path, fall back to the other" idiom
   * BookingsService.bookClass()/cancelBooking() already use to tell their
   * own Guardian-vs-Staff on-behalf-of callers apart. A caller who is
   * neither gets assertGuardianOfStudent's own 403, unchanged.
   *
   * Deliberately NOT a change to RoleGrantsService.create()/GrantableRoleDto
   * — that enum's own header comment is explicit that granting STUDENT "has
   * no confirmed authorization rule" through that path, and Decision 96's
   * STUDENT RoleGrant is created exclusively here; widening the grantable-
   * roles enum would be a second, divergent creation path for the exact
   * same role, not a fix.
   */
  async join(callerId: string, schoolId: string, dto?: JoinSchoolDto) {
    const studentId = dto?.studentId ?? callerId;
    const isOnBehalfOf = dto?.studentId !== undefined && dto.studentId !== callerId;
    let isGuardianAction = false;
    let isStaffAction = false;
    if (isOnBehalfOf) {
      try {
        await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
        isStaffAction = true;
      } catch (err) {
        if (!(err instanceof ForbiddenException)) throw err;
        await this.guardiansService.assertGuardianOfStudent(callerId, studentId);
        isGuardianAction = true;
      }
    }

    const roleGrantId = randomUUID();

    const roleGrant = await this.prismaApp.withTenantContext(studentId, async (tx) => {
      const [{ school_exists: schoolExists }] = await tx.$queryRaw<[{ school_exists: boolean }]>`
        SELECT school_exists(${schoolId})
      `;
      if (!schoolExists) {
        throw new NotFoundException('School not found');
      }

      let created;
      try {
        created = await tx.roleGrant.create({
          data: {
            id: roleGrantId,
            role: 'STUDENT',
            userId: studentId,
            schoolId,
            grantedById: callerId, // self-granted for an ordinary join; the Guardian for an on-behalf-of join
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException(
            isOnBehalfOf ? 'This Student is already enrolled at this School.' : 'You are already a Student at this School.',
          );
        }
        throw err;
      }

      // Home branch (Decisions 139, 168): chosen when joining a School that
      // has branches; a School with none is one branch, so there is nothing
      // to choose. Checked after the STUDENT grant above, in the same
      // transaction: that grant is what lets this context see the School's
      // branches (Branch RLS), and any refusal here rolls it back.
      const branches = await tx.branch.findMany({ where: { schoolId }, select: { id: true } });
      if (branches.length > 0) {
        if (!dto?.branchId) {
          throw new BadRequestException('This School has branches: choose your home branch (branchId).');
        }
        if (!branches.some((b) => b.id === dto.branchId)) {
          throw new BadRequestException('branchId must be a branch of this School.');
        }
        await tx.studentHomeBranch.create({
          data: { id: randomUUID(), schoolId, studentId, branchId: dto.branchId, assignedById: callerId },
        });
      } else if (dto?.branchId) {
        throw new BadRequestException('This School has no branches, so no branch can be chosen.');
      }
      return created;
    });

    if (isGuardianAction || isStaffAction) {
      // No access token to mint — the caller (Guardian or Staff) isn't the
      // one who just got the new grant, so there is nothing on their own
      // session to refresh (see JoinSchoolResponseDto's own comment for the
      // Guardian case, which this now also covers for Staff).
      return roleGrant;
    }

    // Re-mint the caller's own access token now that their STUDENT grant is
    // committed — same narrow exception create() above already uses, called
    // after the write commits for the same reason (issueAccessToken() opens
    // its own transaction/connection and needs to see the just-committed row).
    const accessToken = await this.authService.issueAccessToken(callerId);

    return { ...roleGrant, accessToken };
  }

  /**
   * A School's own, narrow join into a Franchise — School Owner/Manager initiated,
   * self-service, deliberately one-way only (no leave/switch/reaffiliation). Closes a
   * real, previously-unaddressed gap surfaced while researching Phase 16b
   * (FranchiseFeeCharge): grepped every write site in this codebase and confirmed
   * `School.franchiseId` was NEVER written anywhere — `CreateSchoolDto` deliberately
   * excludes it (a self-service-created School is always independent), so there was
   * genuinely no way for a real School to ever become affiliated with a Franchise at
   * all. Same class of gap Decision 96 found and fixed for Student enrollment; see
   * Decision 98 for the full account, including why this needed the user's own
   * direct sign-off rather than a unilateral "best decision" call (it borders the
   * Franchise-reaffiliation topic Decision 97 explicitly deferred).
   *
   * Deliberately NOT a `CreateSchoolDto`/`UpdateSchoolDto` field — a dedicated,
   * single-purpose, auditable action, the same shape `join()` above already
   * established for the Student side of this pattern (POST /schools/:id/join).
   *
   * FOUND ON REVIEW, before this ever shipped — a first draft added a new
   * `franchise_exists()` SECURITY DEFINER function (mirroring `school_exists()`) as
   * a separate existence check before the write, in its own `withTenantContext`
   * call. Two independent review angles caught that this was both unnecessary AND
   * a real, if narrow, correctness regression: `School.franchiseId` already carries
   * a real foreign-key constraint to `Franchise.id` (schema.prisma), and Postgres
   * foreign-key checks always run outside row security by design (documented
   * Postgres behavior — RI checks bypass RLS specifically so referential integrity
   * can't be subverted by a restrictive policy) — so the write below already fails
   * with a real FK-violation error (caught below) if `franchiseId` doesn't
   * reference a real row, with NO separate existence check needed at all. The
   * removed draft also split the (unnecessary) existence check and the write
   * across two separate `withTenantContext` transactions, unlike `join()`
   * immediately above, which deliberately keeps its own existence check and write
   * in ONE transaction for exactly this reason (a real TOCTOU window otherwise) —
   * this version closes that gap too, by removing the second transaction
   * entirely rather than trying to keep both in sync.
   *
   * Idempotency/guard: `updateMany` with a `franchiseId: null` WHERE-clause guard,
   * checked via the returned row count — NOT a separate findUnique-then-update,
   * which would leave a TOCTOU window between two concurrent joins for the same
   * School. This is an UPDATE, not an INSERT, so the "atomic create() + caught
   * P2002" pattern `join()` above uses doesn't apply directly in shape, but the
   * same idea does: the FK-violation catch below plays P2002's role (a real DB
   * constraint surfacing as a clean error, not a plausible-looking pre-check that
   * could itself race), and the conditional `updateMany` plays the uniqueness-guard
   * role.
   *
   * WHAT THIS DELIBERATELY DOES NOT DO (Decision 98, following the user's own
   * explicit direction on Franchise-reaffiliation this session): no "leave a
   * Franchise" or "switch Franchise" path exists anywhere — a School that already
   * has a franchiseId gets 409, never a silent re-link. That is the entire point of
   * keeping this one-way: it never has to answer "what happens to this School's
   * PaymentAccount/MembershipPlan/FranchiseFeeCharge history on reaffiliation"
   * (Spec 55 §12.2, domain-rules §2/§17), because reaffiliation cannot happen
   * through this endpoint. Do not extend this method to support leaving/switching
   * without the user's own "revisit when the project is done" conversation
   * (Decision 97) happening first — that is a real, separate decision, not an
   * incremental extension of this one.
   *
   * Also does NOT create any Stripe subscription or FranchiseFeeCharge row this
   * phase (16b-i) — only the relationship itself. The actual billing mechanics are
   * Phase 16b-ii, built against the real School↔Franchise relationships this method
   * creates, not fixture-only data (the same anti-pattern Decision 96 already
   * flagged and fixed once this session for Student enrollment).
   */
  async joinFranchise(callerId: string, schoolId: string, franchiseId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);

    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      let count: number;
      try {
        ({ count } = await tx.school.updateMany({
          where: { id: schoolId, franchiseId: null },
          data: { franchiseId },
        }));
      } catch (err) {
        // P2003 = foreign key constraint violation — franchiseId doesn't reference
        // a real Franchise row. See this method's own header comment for why this
        // replaces a separate existence-check function entirely, not just avoids
        // duplicating it.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
          throw new NotFoundException('Franchise not found');
        }
        throw err;
      }
      if (count === 0) {
        // Noted on review, not engineered around: `count === 0` here technically
        // conflates two distinct causes — franchiseId genuinely already set, or
        // (an astronomically narrow race) the caller's own SCHOOL_OWNER_MANAGER
        // grant was revoked in the gap between assertSchoolOwner above and this
        // UPDATE reaching Postgres, so school_tenant_isolation's own UPDATE policy
        // silently matched zero rows. Both produce the same, correctly-safe
        // outcome (no write happens either way) — only the error MESSAGE would be
        // misleading in the second case, not the behavior. Disambiguating would
        // need a re-fetch inside this same transaction, undoing the round-trip
        // reduction this method exists to have made; not worth it for a race this
        // narrow with a consequence this small.
        throw new ConflictException(
          'This School is already affiliated with a Franchise — leaving or switching Franchise is not supported yet.',
        );
      }
      return tx.school.findUniqueOrThrow({ where: { id: schoolId } });
    });
  }

  /**
   * A School's own leave/switch-Franchise path — School Owner/Manager initiated,
   * self-service, closing the gap `joinFranchise()`'s own header comment deliberately
   * left open pending the user's "revisit when the project is done" conversation
   * (Decision 97). That conversation happened (Decision 232): `PaymentAccount` and
   * `MembershipPlan` carry over completely unchanged — both already School-owned,
   * with no franchise linkage to sever, so neither needs any write here.
   * `FranchiseFeeCharge` history is retained as an immutable record — this method
   * never touches those rows either. The one real reconciliation point is the live
   * Stripe subscription (`School.stripeFranchiseFeeSubscriptionId`): cancelled here,
   * at departure; a School that then calls `joinFranchise()` again gets a new one
   * created lazily by franchise-fee-usage-reporting's own `ensureSubscription`, the
   * same path every first-time join already goes through. "Switch Franchise" is
   * deliberately NOT a separate combined endpoint — it's this method followed by an
   * ordinary `joinFranchise()` call, which already works again once this clears
   * `franchiseId` back to null.
   *
   * Idempotency/guard: the same conditional `updateMany` shape `joinFranchise()`
   * already established — `count === 0` means the School's `franchiseId` moved out
   * from under this call between the read below and the write (another concurrent
   * leave, or the grant itself was revoked), surfaced as a 409 rather than a silent
   * no-op, for the identical reasoning that method's own header comment gives.
   *
   * The Stripe cancellation is deliberately best-effort, not a precondition: it runs
   * via `PrismaJobsService` (ultm8_jobs) AFTER the `franchiseId` write commits —
   * same "the caller's own RLS context can't see a Franchise it holds no grant on"
   * reasoning, and the same service, `GuardiansService.withdrawConsent()`'s own
   * BASELINE cascade already established for an analogous problem (a School Owner
   * has no FRANCHISE_OWNER grant on the Franchise they're leaving, so `franchise_
   * tenant_isolation`/`payment_account_tenant_isolation` would hide its PaymentAccount
   * from this caller's own tenant context entirely). Ordered AFTER the commit, not
   * before: leaving the Franchise relationship is the actual feature being asked
   * for, and must succeed even if Stripe is unreachable or the subscription is
   * already gone — a stale, uncancelled Stripe subscription is a real but narrow
   * billing-cleanup gap, logged loudly here, not a reason to trap a School in a
   * Franchise it has already, authoritatively, left.
   */
  async leaveFranchise(callerId: string, schoolId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);

    const current = await this.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    if (!current.franchiseId) {
      throw new BadRequestException('This School is not affiliated with any Franchise.');
    }
    const { franchiseId: oldFranchiseId, stripeFranchiseFeeSubscriptionId: oldSubscriptionId } = current;

    const { count } = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.updateMany({
        where: { id: schoolId, franchiseId: oldFranchiseId },
        data: { franchiseId: null, stripeFranchiseFeeSubscriptionId: null, franchiseFeeSubscriptionStatus: null },
      }),
    );
    if (count === 0) {
      throw new ConflictException('This School already left its Franchise — nothing to do.');
    }

    if (oldSubscriptionId) {
      try {
        const oldFranchise = await this.prismaJobs.franchise.findUnique({
          where: { id: oldFranchiseId },
          include: { paymentAccount: true },
        });
        const account = oldFranchise?.paymentAccount;
        if (account?.provider === 'STRIPE' && account.stripeConnectedAccountId) {
          await this.stripeClient.scopedClient(account.stripeConnectedAccountId).subscriptions.cancel(oldSubscriptionId);
        }
      } catch (err) {
        this.logger.error(
          `School ${schoolId} left Franchise ${oldFranchiseId}, but cancelling its standing Stripe subscription (${oldSubscriptionId}) failed — it may need manual cancellation.`,
          err as Error,
        );
      }
    }

    return this.findOne(callerId, schoolId);
  }

  /** Schools visible to the caller — RLS already restricts this to Schools where the
   * caller holds any active RoleGrant (school_tenant_isolation, migration.sql). */
  async findAllForCaller(callerId: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate((args) => tx.school.findMany(args), cursor, limit),
    );
  }

  async findOne(callerId: string, schoolId: string) {
    const school = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUnique({ where: { id: schoolId } }),
    );
    // RLS returns null (not another tenant's row) for a School outside the caller's
    // scope — a genuine 404 and a cross-tenant-blocked read are indistinguishable at
    // this layer by design (ultm8-tenant-isolation §2: "a query missing a tenant filter
    // returns nothing", never an error that could leak existence).
    if (!school) {
      throw new NotFoundException('School not found');
    }
    return school;
  }

  /**
   * The Student roster — Users holding an active STUDENT RoleGrant at this School.
   * Staff-gated broadly (School Owner/Manager, Branch Staff, or Instructor — the
   * same set Bookings/Waitlist's own roster reads already use via
   * assertStaffAtSchool), not School-Owner-only, since seeing who's enrolled is a
   * read any Staff member legitimately needs, unlike Instructors' eligible-users
   * endpoint (which gates an Owner-only write flow). No branchId scoping — a
   * School-wide roster, matching how Student enrollment itself has no Branch
   * dimension (SchoolsService.join() grants schoolId-only, no branchId).
   *
   * Safe from the RLS name-join gap (Decision 117) by construction, same reasoning
   * as InstructorsService.findEligibleInstructorUsers: the RoleGrant row being read
   * (schoolId, role STUDENT, revokedAt null) is itself the exact witness
   * user_self_or_shared_school's visibility check needs, so the joined User row is
   * always visible — no separate PrismaAuthService lookup needed here.
   *
   * `status` (StudentRosterStatusDto) — ACTIVE (default, the exact pre-existing
   * behavior, unchanged query below), INACTIVE (only Students whose every STUDENT
   * RoleGrant at this School is revoked), or ALL (both). v1.2 backend backlog's
   * "Students page" gap: the roster previously hard-coded `revokedAt: null`,
   * silently excluding revoked enrollments with no way to ever see them.
   */
  async findAllStudentsForSchool(callerId: string, schoolId: string, status: StudentRosterStatusDto = StudentRosterStatusDto.ACTIVE) {
    await this.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);

    if (status === StudentRosterStatusDto.ACTIVE) {
      // Unchanged from this method's pre-existing behavior — kept as its own,
      // untouched branch so a caller that never sends `status` sees exactly the
      // same query/result it always has, not a behaviorally-equivalent rewrite.
      const grants = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.roleGrant.findMany({
          where: { schoolId, role: 'STUDENT', revokedAt: null },
          distinct: ['userId'],
          orderBy: { grantedAt: 'asc' },
          select: {
            grantedAt: true,
            user: { select: { id: true, firstName: true, surname: true, email: true } },
          },
        }),
      );
      return {
        items: grants.map((g) => ({ ...g.user, enrolledAt: g.grantedAt, status: StudentStatusDto.ACTIVE })),
      };
    }

    // INACTIVE or ALL — needs every STUDENT RoleGrant (active and revoked) at this
    // School to resolve, per User, whether ANY of them is still non-revoked. Selects
    // `userId` only, NOT a Prisma `include`/`select` on `user` — a revoked RoleGrant
    // is exactly the case Decision 117 already found breaks that join:
    // user_self_or_shared_school requires a currently-ACTIVE overlapping RoleGrant to
    // see another User's row, so an all-revoked Student's own User row isn't visible
    // through this method's own tenant (`ultm8_app`) context at all (confirmed by
    // reproducing it directly — `Field user is required to return data, got null
    // instead`, same failure class Decision 117's own regression test guards
    // against). Names are resolved via PrismaAuthService/resolveUserNames instead,
    // the same established pattern InstructorsService.findAllForSchool already uses
    // for its own Name column.
    const allGrants = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findMany({
        where: { schoolId, role: 'STUDENT' },
        orderBy: { grantedAt: 'asc' },
        select: { userId: true, grantedAt: true, revokedAt: true },
      }),
    );

    const names = await resolveUserNames(this.prismaAuth, allGrants.map((g) => g.userId));
    const byUser = new Map<string, { earliestActiveAt?: Date; latestAt: Date; hasActive: boolean }>();
    for (const g of allGrants) {
      const existing = byUser.get(g.userId);
      const isActive = g.revokedAt === null;
      if (!existing) {
        byUser.set(g.userId, {
          hasActive: isActive,
          earliestActiveAt: isActive ? g.grantedAt : undefined,
          latestAt: g.grantedAt,
        });
      } else {
        if (isActive) {
          existing.hasActive = true;
          if (existing.earliestActiveAt === undefined) existing.earliestActiveAt = g.grantedAt;
        }
        existing.latestAt = g.grantedAt; // allGrants is ordered ascending — last write wins
      }
    }

    let rows = Array.from(byUser.entries()).map(([userId, { hasActive, earliestActiveAt, latestAt }]) => ({
      id: userId,
      firstName: names.get(userId)?.firstName ?? '',
      surname: names.get(userId)?.surname ?? '',
      email: names.get(userId)?.email ?? '',
      status: hasActive ? StudentStatusDto.ACTIVE : StudentStatusDto.INACTIVE,
      enrolledAt: hasActive ? earliestActiveAt! : latestAt,
    }));

    if (status === StudentRosterStatusDto.INACTIVE) {
      rows = rows.filter((r) => r.status === StudentStatusDto.INACTIVE);
    }
    rows.sort((a, b) => a.enrolledAt.getTime() - b.enrolledAt.getTime());

    return { items: rows };
  }

  /** School Owner/Manager only (Spec §8.2) — see TenantAuthorizationService. */
  async update(callerId: string, schoolId: string, dto: UpdateSchoolDto) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);

    const updated = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.update({
        where: { id: schoolId },
        data: {
          name: dto.name,
          mobileNumber: dto.mobileNumber,
          address: dto.address,
          businessType: dto.businessType,
          activities: dto.activities,
          facilities: dto.facilities,
          ranksToggle: dto.ranksToggle,
          defaultLanguage: dto.defaultLanguage,
          defaultCurrency: dto.defaultCurrency,
          timezone: dto.timezone,
          description: dto.description,
          logoUrl: dto.logoUrl,
          bannerUrl: dto.bannerUrl,
          classCancellationPolicy: dto.classCancellationPolicy,
          waitlistClaimWindowMinutes: dto.waitlistClaimWindowMinutes,
        },
      }),
    );
    return updated;
  }

  // No delete method — general tenant offboarding is [UNRESOLVED]
  // (ultm8-app-publishing §4 — not ultm8-domain-rules §2, which covers Franchise/
  // School/Branch structure, not offboarding). Do not add one without a decision.

  /** The School owner assigns or changes a student's home branch (Decision
   * 148: students who joined before branches existed get one from the
   * owner; until then only the owner sees and grades them, Decision 168). */
  async setStudentHomeBranch(callerId: string, schoolId: string, studentId: string, dto: SetHomeBranchDto) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    await this.tenantAuth.assertBranchBelongsToSchool(callerId, dto.branchId, schoolId);

    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const enrolled = await tx.roleGrant.findFirst({
        where: { userId: studentId, schoolId, role: 'STUDENT', revokedAt: null },
        select: { id: true },
      });
      if (!enrolled) {
        throw new NotFoundException('This person is not a Student at this School.');
      }
      return tx.studentHomeBranch.upsert({
        where: { schoolId_studentId: { schoolId, studentId } },
        create: { id: randomUUID(), schoolId, studentId, branchId: dto.branchId, assignedById: callerId },
        update: { branchId: dto.branchId, assignedById: callerId },
      });
    });
  }
}
