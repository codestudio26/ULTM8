import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../../common/prisma/prisma-auth.service';
import { resolveUserNames } from '../../common/prisma/resolve-user-names';
import { PrismaJobsService } from '../../common/prisma/prisma-jobs.service';
import { JOIN_REQUEST_SELECT } from '../franchises/franchises.service';
import { TenantAuthorizationService } from '../tenant-authorization.service';
import { cursorPaginate, CursorPage } from '../../common/pagination/cursor-paginate';
import { AuthService } from '../../auth/auth.service';
import { GuardiansService } from '../../guardians/guardians.service';
import { StripeClientService } from '../../payments/stripe-client.service';
import { FRANCHISE_FEE_FINAL_CANCEL } from '../../franchise-fees/franchise-fee-cancel';
import { UsersService } from '../../users/users.service';
import { WaiverAssignmentService } from '../../waivers/waiver-assignment.service';
import { CreateSchoolDto } from './dto/create-school.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { JoinSchoolDto } from './dto/join-school.dto';
import { SetHomeBranchDto } from './dto/home-branch.dto';
import { UpdateStudentProfileDto } from './dto/update-student-profile.dto';
import { StudentRosterStatusDto, StudentStatusDto } from './dto/student-roster-query.dto';
import { matchesPersonName } from '../../common/search/name-search';
import { addressWriteData } from '../../common/address/postal-address.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaPlatformAdminService } from '../../common/prisma/prisma-platform-admin.service';
import { StepUpService } from '../../auth/step-up.service';
import { NOTIFICATION_FANOUT_QUEUE } from '../../jobs/queue.constants';
import { stopFranchiseFeeBilling } from '../../franchise-fees/stop-franchise-fee-billing';
import { stopSchoolBilling } from '../stop-tenant-billing';
import { sendFranchiseNotice } from '../franchises/franchise-notifications';
import { CloseOwnSchoolDto } from './dto/close-own-school.dto';

/** Decision 110's retention window, the same one the Platform Admin close uses. */
const RETENTION_WINDOW_DAYS = 90;

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
    private readonly usersService: UsersService,
    private readonly waiverAssignment: WaiverAssignmentService,
    private readonly prismaPlatformAdmin: PrismaPlatformAdminService,
    private readonly stepUp: StepUpService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly notificationFanoutQueue: Queue,
  ) {}

  /**
   * Decision 266 — used by regenerateJoinCode() only; School.create() relies
   * on the column's own DB-function default instead (schema.prisma's own
   * comment on `joinCode` explains why). Same 8-character, 32-character
   * unambiguous-alphabet shape as that DB function (no 0/O/1/I, so a Student
   * reading it off a front-desk sign can't confuse characters) — kept as a
   * parallel JS implementation, not a shared one, because there's no clean
   * way to ask Postgres for "a fresh value from your own column default"
   * outside an INSERT. 32^8 ≈ 1.1e12 combinations; the retry loop exists
   * purely as belt-and-suspenders — a real collision would be astronomically
   * unlikely.
   *
   * FOUND ON REVIEW: an earlier draft checked collisions via
   * `prismaDiscovery` (AcademiesModule's dedicated connection) — a genuine
   * violation of that service's own documented "ONLY AcademiesService may
   * inject this" contract. Fixed the same way `school_exists()`
   * (20260919000000_student_self_enrollment) already solved the identical
   * problem for `join()`: a narrow `SECURITY DEFINER` SQL function
   * (`join_code_exists`, this PR's own migration) called from inside the
   * caller's own `prismaApp` tenant-context transaction — existence of a
   * join code is cross-tenant information by definition (the whole point is
   * a code identifying a School nobody has joined yet), so the function
   * needs to bypass RLS, but that's now scoped to exactly this one
   * boolean check, not a connection to another module's role.
   */
  private readonly JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  private async generateUniqueJoinCode(callerId: string): Promise<string> {
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      for (let attempt = 0; attempt < 20; attempt++) {
        let candidate = '';
        for (let i = 0; i < 8; i++) {
          candidate += this.JOIN_CODE_ALPHABET[Math.floor(Math.random() * this.JOIN_CODE_ALPHABET.length)];
        }
        const [{ join_code_exists: exists }] = await tx.$queryRaw<[{ join_code_exists: boolean }]>`
          SELECT join_code_exists(${candidate})
        `;
        if (!exists) {
          return candidate;
        }
      }
      // Reaching this would mean 20 consecutive collisions out of 1.1e12
      // possibilities — treated as an environment/generator fault, not a
      // normal error path a caller should retry past.
      throw new Error('Could not generate a unique School join code after 20 attempts');
    });
  }

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
      // joinCode is NOT set here — the column's own DB-function default
      // (migration 20261115000001) generates it; the created row below
      // already carries the real value Postgres assigned, same as any
      // other DB-defaulted column (id aside, which this codebase always
      // mints client-side for the RoleGrant-in-the-same-transaction reason
      // explained elsewhere, not relevant to joinCode).
      const created = await tx.school.create({
        data: {
          id: schoolId,
          name: dto.name,
          mobileNumber: dto.mobileNumber,
          ...addressWriteData(dto),
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
          accentColor: dto.accentColor,
          footerAboutUs: dto.footerAboutUs,
          footerContactEmail: dto.footerContactEmail,
          footerContactPhone: dto.footerContactPhone,
          footerFacebookUrl: dto.footerFacebookUrl,
          footerInstagramUrl: dto.footerInstagramUrl,
          footerTiktokUrl: dto.footerTiktokUrl,
          footerYoutubeUrl: dto.footerYoutubeUrl,
          footerTwitterUrl: dto.footerTwitterUrl,
          classCancellationPolicy: dto.classCancellationPolicy,
          waitlistClaimWindowMinutes: dto.waitlistClaimWindowMinutes,
          classCancellationPolicyWindow: dto.classCancellationPolicyWindow,
          chargeLateCancellationFee: dto.chargeLateCancellationFee,
          schoolCancelledClassResolution: dto.schoolCancelledClassResolution,
          defaultRefundCutoffHours: dto.defaultRefundCutoffHours,
          noShowFee: dto.noShowFee,
          // Decision 292 — saving a policy is the owner choosing it.
          ...(dto.classCancellationPolicy !== undefined ? { cancellationPolicyChosenAt: new Date() } : {}),
          checkInOpensMinutesBeforeStart: dto.checkInOpensMinutesBeforeStart,
          lateCancelRefundPolicy: dto.lateCancelRefundPolicy,
          branchStaffCanRecordPayments: dto.branchStaffCanRecordPayments,
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

      // v1.2 backend backlog ("Waivers page", gap 2) — the other real
      // "assignment" moment this codebase has: an existing Waiver meeting a
      // NEWLY-JOINED Student (the other side is WaiversService.createWaiver(),
      // a NEW Waiver meeting existing Students — see WaiverAssignmentService's
      // own header comment for the full two-sided account). Queried in the
      // same transaction, AFTER the STUDENT grant above — that grant is what
      // lets this context see this School's Waivers at all (Waiver's RLS is
      // "any active RoleGrant holder at the School"), same reasoning the home
      // branch lookup just above already relies on for Branch's own RLS.
      // Waivers review W6: an archived Waiver is not assigned to new members.
      const waivers = await tx.waiver.findMany({ where: { schoolId, archivedAt: null }, select: { id: true } });
      await this.waiverAssignment.assignUnsignedRows(
        tx,
        schoolId,
        waivers.map((w) => w.id),
        [studentId],
      );

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
   * School Owner/Manager asks to join a Franchise by its ID. Decision 352 (product
   * owner, 27 Oct 2026): the School no longer joins at once; this records a
   * PENDING FranchiseJoinRequest and the Franchise Owner accepts (the School
   * joins, FranchisesService.decideJoinRequest) or declines. One open request
   * per School (a partial unique index). A School already in a Franchise leaves
   * first (Decision 232), and closed Schools and Franchises can't take part
   * (Decision 337, F3/F4). The Franchise row isn't visible to a School Owner
   * under RLS, so its existence and closed state are read on the jobs
   * connection; the School's name is copied onto the request because the
   * Franchise Owner can't read a non-member School.
   */
  async joinFranchise(callerId: string, schoolId: string, franchiseId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    // Decision 337 (F4) — a closed School can't join, the same rule leaveFranchise()
    // and every other write at a closed School already follow.
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    // Decision 337 (F3) — nor can anyone join a closed Franchise. A School Owner
    // can't read the Franchise row through RLS, so this one-column check uses the
    // same jobs connection leaveFranchise() below already uses for the Franchise's
    // PaymentAccount.
    const target = await this.prismaJobs.franchise.findUnique({ where: { id: franchiseId }, select: { name: true, archivedAt: true } });
    if (!target) {
      throw new NotFoundException('Franchise not found');
    }
    if (target.archivedAt) {
      throw new ForbiddenException('This Franchise has been closed and no longer accepts new Schools.');
    }

    // Decision 352 — joining asks the Franchise Owner, who accepts or declines
    // (FranchisesService.decideJoinRequest); the School no longer joins at once.
    const request = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const school = await tx.school.findUnique({ where: { id: schoolId }, select: { name: true, franchiseId: true } });
      if (!school) {
        throw new NotFoundException('School not found');
      }
      if (school.franchiseId) {
        throw new ConflictException('This School is already in a Franchise. Leave it first, then join the new one.');
      }
      try {
        return await tx.franchiseJoinRequest.create({
          data: { franchiseId, schoolId, schoolName: school.name, requestedById: callerId },
          select: JOIN_REQUEST_SELECT,
        });
      } catch (err) {
        // P2002 — the partial unique index: one open request per School.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('This School has already asked to join a Franchise. Cancel that request first.');
        }
        throw err;
      }
    });
    // Decision 364 — the Franchise's Owners hear that a School is asking.
    await sendFranchiseNotice(this.notificationFanoutQueue, this.prismaJobs, this.logger, {
      kind: 'ASKED',
      requestId: request.id,
      franchiseId,
      franchiseName: target.name,
      schoolId,
      schoolName: request.schoolName,
    });
    return request;
  }

  /** Decision 352 — the School's latest request to join a Franchise, or null. */
  async findFranchiseJoinRequest(callerId: string, schoolId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const request = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.franchiseJoinRequest.findFirst({ where: { schoolId }, orderBy: { createdAt: 'desc' }, select: JOIN_REQUEST_SELECT }),
    );
    return { request };
  }

  /** Decision 352 — the School withdraws its open request. */
  async cancelFranchiseJoinRequest(callerId: string, schoolId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const open = await tx.franchiseJoinRequest.findFirst({ where: { schoolId, status: 'PENDING' }, select: { id: true } });
      if (!open) {
        throw new NotFoundException('This School has no open request to join a Franchise.');
      }
      const { count } = await tx.franchiseJoinRequest.updateMany({
        where: { id: open.id, status: 'PENDING' },
        data: { status: 'CANCELLED', decidedAt: new Date() },
      });
      if (count === 0) {
        throw new ConflictException('This join request has already been answered.');
      }
      return tx.franchiseJoinRequest.findUniqueOrThrow({ where: { id: open.id }, select: JOIN_REQUEST_SELECT });
    });
  }

  /**
   * Decision 364 — a School Owner closes their own School: the same close a
   * Full Platform Admin can do (TenantLifecycleService.closeSchool, Decision
   * 110): read-only from now, purged after 90 days, reopened only by a Platform
   * Admin. Needs the School's name re-typed and a fresh passcode check
   * (StepUpService, the X-Step-Up-Token header). The write uses the
   * platform-admin connection, which holds the only grant on archivedAt/purgeAt,
   * after the ownership check. Then, as on every close: the franchise fee stops
   * (Decision 337, F16), an open request to join a Franchise lapses (Decision
   * 352), and the Students' Subscriptions and the School's own ULTM8
   * subscription end with their paid period (stopSchoolBilling).
   */
  async closeOwnSchool(callerId: string, schoolId: string, dto: CloseOwnSchoolDto, stepUpToken: string | undefined) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    this.stepUp.assertVerified(callerId, stepUpToken);
    const school = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUnique({ where: { id: schoolId }, select: { name: true, archivedAt: true } }),
    );
    if (!school) {
      throw new NotFoundException('School not found');
    }
    if (school.archivedAt) {
      throw new ConflictException('This School is already closed.');
    }
    if (dto.confirmName !== school.name) {
      throw new BadRequestException("Type the School's name exactly as it is to close it.");
    }
    const now = new Date();
    const purgeAt = new Date(now.getTime() + RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prismaPlatformAdmin.school.updateMany({
      where: { id: schoolId, archivedAt: null },
      data: { archivedAt: now, purgeAt },
    });
    if (count === 0) {
      throw new ConflictException('This School is already closed.');
    }
    await stopFranchiseFeeBilling(this.prismaJobs, this.stripeClient, this.logger, { schoolId });
    await this.prismaJobs.franchiseJoinRequest.updateMany({ where: { schoolId, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: now } });
    await stopSchoolBilling(this.prismaJobs, this.stripeClient, this.logger, schoolId, callerId);
    return this.prismaJobs.school.findUniqueOrThrow({ where: { id: schoolId }, select: { id: true, archivedAt: true, purgeAt: true } });
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
        data: { franchiseId: null, stripeFranchiseFeeSubscriptionId: null, franchiseFeeSubscriptionStatus: null, showFranchiseBranding: false },
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
          // Decision 337 (F19, product owner's answer to Q9) — the School pays for
          // the month it leaves in: the subscription is cancelled with a final
          // invoice for what has accrued (a Per-headcount School's count was
          // reported on the 1st), so the month's Pending fee charge resolves
          // instead of staying Pending forever. No proration credit either way.
          await this.stripeClient
            .scopedClient(account.stripeConnectedAccountId)
            .subscriptions.cancel(oldSubscriptionId, FRANCHISE_FEE_FINAL_CANCEL);
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
   * FOUND ON REVIEW — Decision 266's apps/student SchoolThemeProvider only
   * needs accentColor/logoUrl; a narrow `select` here (same RLS visibility
   * as findOne() above — any RoleGrant holder, a Student's STUDENT grant
   * included) instead of making it call the full findOne(). See
   * SchoolThemeResponseDto's own comment for why this exists at all.
   */
  async findTheme(callerId: string, schoolId: string) {
    const school = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUnique({ where: { id: schoolId }, select: { id: true, accentColor: true, logoUrl: true } }),
    );
    if (!school) {
      throw new NotFoundException('School not found');
    }
    return school;
  }

  /**
   * Decision 350 — the Franchise's name and logo for a member School, shown only
   * when both owners allow it. Same RLS visibility as findTheme() (any RoleGrant
   * holder at the School). The Franchise row itself isn't visible to School-side
   * callers under RLS, so it's read through prismaJobs, and only after the School
   * read above proved the caller can see this School; nothing beyond the name and
   * logo leaves this method, and those only when both switches are on.
   */
  async findFranchiseBranding(callerId: string, schoolId: string) {
    const school = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUnique({ where: { id: schoolId }, select: { franchiseId: true, showFranchiseBranding: true } }),
    );
    if (!school) {
      throw new NotFoundException('School not found');
    }
    const franchise = school.franchiseId
      ? await this.prismaJobs.franchise.findUnique({
          where: { id: school.franchiseId },
          select: { name: true, logoUrl: true, archivedAt: true, shareBrandingWithMembers: true },
        })
      : null;
    const franchiseAllows = !!franchise && !franchise.archivedAt && franchise.shareBrandingWithMembers;
    const shown = franchiseAllows && school.showFranchiseBranding;
    return {
      franchiseAllows,
      schoolShows: school.showFranchiseBranding,
      name: shown ? franchise!.name : null,
      logoUrl: shown ? franchise!.logoUrl : null,
    };
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
  /** Decision 278 — `search` (header Global Search) narrows whichever roster the
   * caller is already allowed to read, in memory (matchesPersonName's own header
   * comment says why not a relation filter). Omitted or blank, nothing changes. */
  async findAllStudentsForSchool(
    callerId: string,
    schoolId: string,
    status: StudentRosterStatusDto = StudentRosterStatusDto.ACTIVE,
    search?: string,
  ) {
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
            user: { select: { id: true, firstName: true, surname: true, email: true, profilePhotoUrl: true } },
          },
        }),
      );
      const items = grants.map((g) => ({ ...g.user, enrolledAt: g.grantedAt }));
      // Decision 353 (Q4): RLS shows Branch Staff and coaches at a School with
      // branches no students, so add the ones they cover, their home branch's
      // (Decision 139's rule; staff_student_roster, 20261202000100).
      const covered = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.$queryRaw<Array<{ id: string; firstName: string; surname: string; email: string; profilePhotoUrl: string | null; enrolledAt: Date }>>`SELECT * FROM staff_student_roster(${schoolId})`,
      );
      const seen = new Set(items.map((i) => i.id));
      items.push(...covered.filter((c) => !seen.has(c.id)));
      return {
        items: items
          .filter((g) => !search || matchesPersonName(g.firstName, g.surname, search))
          .map((g) => ({ ...g, status: StudentStatusDto.ACTIVE })),
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
      profilePhotoUrl: names.get(userId)?.profilePhotoUrl ?? null,
      status: hasActive ? StudentStatusDto.ACTIVE : StudentStatusDto.INACTIVE,
      enrolledAt: hasActive ? earliestActiveAt! : latestAt,
    }));

    if (status === StudentRosterStatusDto.INACTIVE) {
      rows = rows.filter((r) => r.status === StudentStatusDto.INACTIVE);
    }
    if (search) {
      rows = rows.filter((r) => matchesPersonName(r.firstName, r.surname, search));
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
          ...addressWriteData(dto),
          businessType: dto.businessType,
          activities: dto.activities,
          facilities: dto.facilities,
          ranksToggle: dto.ranksToggle,
          showFranchiseBranding: dto.showFranchiseBranding,
          defaultLanguage: dto.defaultLanguage,
          defaultCurrency: dto.defaultCurrency,
          timezone: dto.timezone,
          description: dto.description,
          logoUrl: dto.logoUrl,
          bannerUrl: dto.bannerUrl,
          accentColor: dto.accentColor,
          footerAboutUs: dto.footerAboutUs,
          footerContactEmail: dto.footerContactEmail,
          footerContactPhone: dto.footerContactPhone,
          footerFacebookUrl: dto.footerFacebookUrl,
          footerInstagramUrl: dto.footerInstagramUrl,
          footerTiktokUrl: dto.footerTiktokUrl,
          footerYoutubeUrl: dto.footerYoutubeUrl,
          footerTwitterUrl: dto.footerTwitterUrl,
          classCancellationPolicy: dto.classCancellationPolicy,
          waitlistClaimWindowMinutes: dto.waitlistClaimWindowMinutes,
          classCancellationPolicyWindow: dto.classCancellationPolicyWindow,
          chargeLateCancellationFee: dto.chargeLateCancellationFee,
          schoolCancelledClassResolution: dto.schoolCancelledClassResolution,
          defaultRefundCutoffHours: dto.defaultRefundCutoffHours,
          noShowFee: dto.noShowFee,
          // Decision 292 — saving a policy is the owner choosing it.
          ...(dto.classCancellationPolicy !== undefined ? { cancellationPolicyChosenAt: new Date() } : {}),
          checkInOpensMinutesBeforeStart: dto.checkInOpensMinutesBeforeStart,
          lateCancelRefundPolicy: dto.lateCancelRefundPolicy,
          branchStaffCanRecordPayments: dto.branchStaffCanRecordPayments,
        },
      }),
    );
    return updated;
  }

  /**
   * Decision 266 — an Owner-initiated reset of the School's join code (e.g.
   * it leaked on a public sign, or they just want a fresh one). Same
   * generation path as create(), same not-archived gate as update() — a
   * closed School accepts no further writes, joining it is one.
   */
  async regenerateJoinCode(callerId: string, schoolId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);

    const joinCode = await this.generateUniqueJoinCode(callerId);
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.update({ where: { id: schoolId }, data: { joinCode } }),
    );
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

  /**
   * `PATCH /schools/{schoolId}/students/{studentId}/profile` — v1.2 backend
   * backlog's Student Detail "Edit" gap: a Staff member editing a Student's own
   * profile on their behalf. `PATCH /users/me` (UsersController) is self-service
   * only and obviously can't serve this.
   *
   * Authorization is the SAME `assertStaffAtSchool` gate findAllStudentsForSchool/
   * BookingsService.findAllForStudent/getWeeklySummary already use for a Staff
   * member acting on a specific Student at this School — not the narrower
   * `assertSchoolOwner` setStudentHomeBranch above uses, since editing a Student's
   * contact details is an ordinary Staff action (any School Owner/Manager, Branch
   * Staff, or Instructor), not a School-Owner-gated one like assigning a home
   * Branch. No `targetBranchId` passed to assertStaffAtSchool — same reasoning as
   * findAllStudentsForSchool's own comment: Student enrollment has no Branch
   * dimension, so there's nothing to scope a Branch Staff grant against here.
   *
   * Field scope: UpdateStudentProfileDto reuses UpdateUserDto outright — see that
   * DTO's own header comment for why `email`/`phone` stay excluded here too (they're
   * unique login/OTP identifiers; letting Staff change either on a Student's behalf
   * would let Staff silently redirect that Student's login/OTP destination, the
   * exact risk self-service already walls off).
   *
   * The actual write is delegated to UsersService.updateProfileFor (shared with
   * `updateMe`, see its own header comment) rather than duplicated here — this
   * method's own job is purely the Staff-on-behalf-of authorization layer:
   * confirming the caller is Staff at this School (not just anyone who can see it —
   * findOne() below only 404s a School invisible/non-existent to the caller at all,
   * same two-step order findAllStudentsForSchool already uses) and that `studentId`
   * is an actual, currently-enrolled Student at this same School (same
   * `RoleGrant`-lookup shape setStudentHomeBranch above already uses, deliberately
   * copied rather than factored out purely for this: the business logic is simple
   * enough — and setStudentHomeBranch's own check is School-Owner-gated,
   * inapplicable here as a shared helper — that extracting a third method solely to
   * avoid five duplicated lines would cost more clarity than it saves).
   */
  async updateStudentProfile(callerId: string, schoolId: string, studentId: string, dto: UpdateStudentProfileDto) {
    await this.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);

    const enrolled = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findFirst({
        where: { userId: studentId, schoolId, role: 'STUDENT', revokedAt: null },
        select: { id: true },
      }),
    );
    if (!enrolled) {
      throw new NotFoundException('This person is not a Student at this School.');
    }

    return this.usersService.updateProfileFor(callerId, studentId, dto);
  }
}
