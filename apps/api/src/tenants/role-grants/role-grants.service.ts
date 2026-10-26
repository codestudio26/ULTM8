import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as bcrypt from 'bcryptjs';
import { PrismaAppService } from '../../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../../common/prisma/prisma-auth.service';
import { TenantAuthorizationService } from '../tenant-authorization.service';
import { CoachInvitesService } from '../coach-invites/coach-invites.service';
import { SchoolsService } from '../schools/schools.service';
import { NotificationDeliveryService } from '../../notifications/notification-delivery.service';
import { cursorPaginate, CursorPage } from '../../common/pagination/cursor-paginate';
import { resolveUserNames } from '../../common/prisma/resolve-user-names';
import { WAITLIST_CASCADE_PROCESSING_QUEUE } from '../../jobs/queue.constants';
import { cancelPlacesOfLeavingStudent } from '../../bookings/leaving-student-cancellation';
import { CreateRoleGrantDto } from './dto/create-role-grant.dto';
import { LookupInviteCandidateQueryDto } from './dto/lookup-invite-candidate-query.dto';
import { CreateStaffManuallyDto } from './dto/create-staff-manually.dto';

const BCRYPT_ROUNDS = 12;

/** Display label per GrantableRoleDto value, for the "you've been granted..."
 * notification email's subject/body — this endpoint only ever creates these three
 * (see GRANTABLE_ROLES below), so no other role needs an entry here. */
const ROLE_LABELS: Record<string, string> = {
  INSTRUCTOR: 'Instructor',
  BRANCH_STAFF: 'Branch Staff',
  SCHOOL_OWNER_MANAGER: 'Owner/Manager',
};

/** The roles this endpoint is authorized to GRANT — see CreateRoleGrantDto.
 * SCHOOL_OWNER_MANAGER added by Decision 270. */
const GRANTABLE_ROLES = ['INSTRUCTOR', 'BRANCH_STAFF', 'SCHOOL_OWNER_MANAGER'] as const;

/**
 * The roles this endpoint is authorized to REVOKE (v1.2 backend backlog —
 * Student Detail's/Instructor Detail's "Revoke Enrollment" action) — a
 * strictly wider set than GRANTABLE_ROLES above, since revoking an existing
 * grant is a different, narrower authorization question than creating one:
 * STUDENT is deliberately excluded from GrantableRoleDto (see its own header
 * comment — "granting... STUDENT... has no confirmed authorization rule"),
 * but that's about who may self-service-enroll vs. be invited; it says
 * nothing about whether a School Owner/Manager may end an EXISTING Student's
 * enrollment, which has its own confirmed basis (the v1.2 backlog's own
 * "Revoke Enrollment action... Proposed" entry for Student Detail,
 * Instructor's own identical gap tracked right beside it). Revoking a
 * STUDENT grant through revoke() below is purely additive: every existing
 * INSTRUCTOR/BRANCH_STAFF caller is unaffected, and the method's own
 * gradingPermission/staffPermission cleanup below is already keyed to those
 * two roles specifically, so a STUDENT revoke simply finds nothing to clean
 * up there (a pure Student never holds either).
 */
const REVOCABLE_ROLES = ['INSTRUCTOR', 'BRANCH_STAFF', 'STUDENT'] as const;

@Injectable()
export class RoleGrantsService {
  private readonly logger = new Logger(RoleGrantsService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly coachInvites: CoachInvitesService,
    private readonly schoolsService: SchoolsService,
    private readonly delivery: NotificationDeliveryService,
    @InjectQueue(WAITLIST_CASCADE_PROCESSING_QUEUE) private readonly waitlistCascadeQueue: Queue,
  ) {}

  /** Same convention as CoachInvitesService/InstructorsService's own
   * portalBaseUrl() — called only from inside create()'s non-blocking email
   * try/catch below, never ahead of the grant itself: unlike a coach-invite
   * link or an Add-Manually temp passcode, this notification isn't the only
   * way the grantee learns of or can use their new role (they already have an
   * account and can just log in), so a missing/misconfigured env var must not
   * block the grant. */
  private portalBaseUrl(): string {
    const url = process.env.PORTAL_BASE_URL?.trim().replace(/\/+$/, '');
    if (!url) throw new Error('PORTAL_BASE_URL is not configured.');
    return url;
  }

  /**
   * School Owner/Manager granting Instructor or Branch Staff within their own School
   * (Spec §8.2), or — as of Decision 270 — another SCHOOL_OWNER_MANAGER at that same
   * School (co-ownership/succession). See CreateRoleGrantDto's header comment for why
   * every other role/grantor combination remains out of scope.
   */
  async create(callerId: string, targetUserId: string, dto: CreateRoleGrantDto) {
    await this.tenantAuth.assertSchoolOwner(callerId, dto.schoolId);
    // Decision 110 — a closed School accepts no further writes; Add Manually
    // below already checked this, this path didn't (Decision 296).
    await this.tenantAuth.assertSchoolNotArchived(callerId, dto.schoolId);

    // The verification gate from "we verify the accounts" (Decision 80) applies to the
    // GRANTOR, not the grantee — corrected by Decision 81 after the product owner was
    // asked directly, which ruled out the target-side check this originally had.
    // Checked fresh against the DB (not the JWT, which carries no phoneVerifiedAt
    // claim) via the caller's own ordinary RLS-scoped context — this is a self-lookup
    // (user_self_or_shared_school's "id = current_setting(...)" clause), so it doesn't
    // need PrismaAuthService's pre-tenant-context bypass the way the target-existence
    // check below does.
    const caller = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.user.findUnique({ where: { id: callerId }, select: { phoneVerifiedAt: true, firstName: true, surname: true } }),
    );
    if (!caller?.phoneVerifiedAt) {
      throw new ForbiddenException(
        'Your account must complete phone verification (POST /auth/otp/verify) before you can grant roles.',
      );
    }

    if (dto.role === 'BRANCH_STAFF' && !dto.branchId) {
      throw new BadRequestException('branchId is required when role is BRANCH_STAFF');
    }

    // SCHOOL_OWNER_MANAGER has no Branch concept (assertSchoolOwner's own query is
    // School-scoped only, no branchId column) — reject a branchId outright rather than
    // silently ignore it, so a caller never thinks they scoped an Owner/Manager grant
    // to one Branch when the grant is actually School-wide.
    if (dto.role === 'SCHOOL_OWNER_MANAGER' && dto.branchId) {
      throw new BadRequestException('branchId must not be provided when role is SCHOOL_OWNER_MANAGER — this role is School-wide.');
    }

    // Target user must exist — no verification precondition on the target as of
    // Decision 81 (see above). Uses PrismaAuthService (see its header comment) because
    // no shared RoleGrant exists yet to make the target visible via the ordinary
    // RLS-scoped path.
    const targetUser = await this.prismaAuth.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, firstName: true },
    });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    const school = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUnique({ where: { id: dto.schoolId }, select: { id: true, name: true } }),
    );
    if (!school) {
      throw new NotFoundException('School not found');
    }

    // Decision 169: an instructor always belongs to something. In a School
    // with branches that is a branch (one grant per branch for an instructor
    // who teaches at several, Decision 168); a School with no branches is
    // itself the branch, so the grant stays School-wide.
    if (dto.role === 'INSTRUCTOR' && !dto.branchId) {
      const anyBranch = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.branch.findFirst({ where: { schoolId: dto.schoolId }, select: { id: true } }),
      );
      if (anyBranch) {
        throw new BadRequestException(
          'This School has branches: choose the branch this instructor belongs to (branchId). Add one grant per branch for an instructor who teaches at several.',
        );
      }
    }

    let branchName: string | null = null;
    if (dto.branchId) {
      const branch = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.branch.findUnique({ where: { id: dto.branchId }, select: { id: true, schoolId: true, name: true, archivedAt: true } }),
      );
      if (!branch || branch.schoolId !== dto.schoolId) {
        throw new BadRequestException('branchId must reference a Branch belonging to schoolId');
      }
      // Decision 296: nobody new joins a Branch that is waiting to be purged.
      if (branch.archivedAt) {
        throw new BadRequestException('This branch has been archived. Choose another branch.');
      }
      branchName = branch.name;
    }

    const duplicate = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findFirst({
        where: {
          userId: targetUserId,
          schoolId: dto.schoolId,
          branchId: dto.branchId ?? null,
          role: dto.role,
          revokedAt: null,
        },
        select: { id: true },
      }),
    );
    if (duplicate) {
      throw new ConflictException('This user already holds an active grant of this role at this scope.');
    }

    const roleGrantId = randomUUID();
    const grant = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.create({
        data: {
          id: roleGrantId,
          role: dto.role,
          userId: targetUserId,
          schoolId: dto.schoolId,
          branchId: dto.branchId,
          grantedById: callerId,
        },
      }),
    );
    // NOTE: this does not affect any access token targetUserId already holds — JWTs are
    // only rebuilt from the live RoleGrant set at login/refresh time (Spec §8.3). If
    // they're already logged in, the new grant has no effect until their token is
    // reissued. Flagged in the Phase 2 summary per the phase brief's own instruction.

    // "You've been granted the Instructor role..." notification — previously
    // missing entirely: the grant itself always succeeded, but the invited
    // user had no way to learn about it short of noticing it themselves on
    // next login. Non-blocking, same emailSent shape CoachInvitesService.
    // create()/InstructorsService.createManually() already established — the
    // grant above has already committed, so a delivery failure here (or
    // PORTAL_BASE_URL being unset) must never undo or appear to undo it.
    const roleLabel = ROLE_LABELS[dto.role] ?? dto.role;
    const where = branchName ? `${school.name} (${branchName})` : school.name;
    const inviter = caller.firstName || caller.surname ? `${caller.firstName} ${caller.surname}` : 'Your school';
    let emailSent = true;
    try {
      const baseUrl = this.portalBaseUrl();
      await this.delivery.sendEmail(
        targetUser.email,
        `You've been granted the ${roleLabel} role at ${school.name}`,
        [
          `${inviter} has granted you the ${roleLabel} role at ${where} on ULTM8.`,
          '',
          'Sign in to see it:',
          `${baseUrl}/login`,
        ].join('\n'),
      );
    } catch (err) {
      emailSent = false;
      this.logger.warn(`RoleGrant ${grant.id}: the notification email could not be sent — ${err instanceof Error ? err.message : String(err)}`);
    }

    return { ...grant, emailSent };
  }

  /** Strict variant of portalBaseUrl() above, for createStaffManually() only — mirrors
   * InstructorsService's own private portalBaseUrl() exactly. Unlike create()'s
   * "you've been granted a role" notification (which isn't the only way the grantee
   * learns of their new role — they already have an account and can just log in), a
   * temp-passcode email from Add Manually genuinely IS the only way the new Staff
   * member can ever learn their own passcode, so this must fail LOUD and BEFORE
   * anything is created, not swallowed inside a non-blocking try/catch. */
  private strictPortalBaseUrl(): string {
    const url = process.env.PORTAL_BASE_URL?.trim().replace(/\/+$/, '');
    if (!url) throw new ServiceUnavailableException('Staff "Add Manually" is not set up yet: PORTAL_BASE_URL is not configured.');
    return url;
  }

  /**
   * POST /schools/:schoolId/role-grants/add-manually (Decision 251) — Staff "Add
   * Manually", closing the exact gap Decision 237's own "What this does NOT resolve"
   * section flagged: "Whether AccountInvitation... should still exist for Staff's own
   * identical from-zero-invite gap." The product owner's own direct answer, when asked:
   * "Yes — same pattern as Instructor: real User+RoleGrant created immediately, temp
   * passcode emailed, forced change on first login."
   *
   * Lives here on RoleGrantsService, not as a new module/controller, because
   * RoleGrantsService already owns all Staff CRUD (GRANTABLE_ROLES above) — "Staff" is
   * not a separate Role or profile table the way Instructor is its own table; it IS a
   * RoleGrant row with role: 'BRANCH_STAFF'. So unlike
   * InstructorsService.createManually() (User + RoleGrant + a third Instructor profile
   * row), this method creates only User + RoleGrant — there is no third row to create.
   *
   * branchId is REQUIRED outright (CreateStaffManuallyDto's own validation), not
   * conditional on whether the School has branches the way Instructor's own add-
   * manually flow is — Branch Staff always needs a branchId, full stop (same rule
   * create() above already enforces for an existing-user BRANCH_STAFF grant, and the
   * same thing StaffPage.tsx's own `needsBranch` logic already assumes client-side).
   *
   * School Owner/Manager only — same gate create() above already uses (Spec §8.2).
   */
  async createStaffManually(callerId: string, schoolId: string, dto: CreateStaffManuallyDto) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);

    const email = dto.email.trim().toLowerCase();
    const baseUrl = this.strictPortalBaseUrl();

    // Branch Staff always belongs to a specific Branch — CreateStaffManuallyDto
    // already makes branchId required at the validation layer; this just checks it
    // actually belongs to this School, same as create()'s own branchId check below.
    await this.tenantAuth.assertBranchBelongsToSchool(callerId, dto.branchId, schoolId);
    // Decision 296: nobody new joins a Branch that is waiting to be purged.
    const branch = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.branch.findUnique({ where: { id: dto.branchId }, select: { archivedAt: true } }),
    );
    if (branch?.archivedAt) {
      throw new BadRequestException('This branch has been archived. Choose another branch.');
    }

    // Decision 116's existing-email check, same PrismaAuthService pre-tenant-context
    // lookup InstructorsService.createManually()/create() below/AuthService.register()
    // all already use — closes the risk of two divergent paths (Add Manually vs. an
    // existing account) ever producing two accounts for one person.
    const existingUser = await this.prismaAuth.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser) {
      throw new ConflictException('An account with this email already exists — use "Invite staff" instead.');
    }

    const userId = randomUUID();
    const roleGrantId = randomUUID();
    const tempPasscode = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const passcodeHash = await bcrypt.hash(tempPasscode, BCRYPT_ROUNDS);

    const grant = await this.prismaApp.withMultiTenantContext(async (tx, setContext) => {
      // Bootstrap trick (AuthService.register()'s own pattern, reused by
      // InstructorsService.createManually()/GuardiansService.createMinor()): User's RLS
      // WITH CHECK only permits inserting a row whose id equals the CURRENT tenant
      // context, so the new Staff member's User row is created under ITS OWN
      // (about-to-exist) id.
      await setContext(userId);
      await tx.user.create({
        data: {
          id: userId,
          email,
          firstName: dto.firstName,
          surname: dto.surname,
          passcodeHash,
          mustChangePasscode: true,
          // phone/dateOfBirth deliberately left null — filled in by the Staff
          // member themselves after their first login, same as Instructor's own
          // Add Manually flow.
        },
      });

      await setContext(callerId);
      return tx.roleGrant.create({
        data: { id: roleGrantId, role: 'BRANCH_STAFF', userId, schoolId, branchId: dto.branchId, grantedById: callerId },
      });
    });

    // Same non-blocking-email-failure shape as CoachInvitesService.create()/
    // InstructorsService.createManually(): creation already succeeded; only the
    // delivery can fail independently of it.
    let emailSent = true;
    try {
      await this.delivery.sendEmail(
        email,
        'Your ULTM8 staff account is ready',
        [
          "You've been added as Staff on ULTM8.",
          '',
          `Sign in with this email address (${email}) and the temporary passcode below — you'll be asked to choose your own passcode right away.`,
          '',
          `Temporary passcode: ${tempPasscode}`,
          '',
          `${baseUrl}/login`,
        ].join('\n'),
      );
    } catch (err) {
      emailSent = false;
      this.logger.warn(`Staff RoleGrant ${grant.id}: the temp-passcode email could not be sent — ${err instanceof Error ? err.message : String(err)}`);
    }

    return { ...grant, userFirstName: dto.firstName, userSurname: dto.surname, email, emailSent };
  }

  /**
   * Exact email/phone match only, never a name search (Decision 116) — the invite
   * target has no RoleGrant at this School yet, so user_self_or_shared_school can't
   * cover the read; this is a lookup-then-confirm step ahead of create(), which
   * remains untouched. Uses PrismaAuthService (see its own header comment), the same
   * pre-tenant-context bypass create()'s own target-existence-by-id check already
   * uses, generalized to accept email/phone instead of only a known id.
   *
   * School Owner/Manager only, gated *before* the lookup runs — an exact-match lookup
   * can confirm whether an email/phone is registered, the same class of exposure
   * AuthService.register()'s own already-taken check already accepts for any
   * anonymous caller; here the caller must already hold a real SCHOOL_OWNER_MANAGER
   * grant, a materially higher bar, so this isn't a new risk category.
   */
  async lookupInviteCandidate(callerId: string, schoolId: string, query: LookupInviteCandidateQueryDto) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);

    if (!query.email && !query.phone) {
      throw new BadRequestException('email or phone is required');
    }

    const candidate = await this.prismaAuth.user.findFirst({
      where: {
        OR: [...(query.email ? [{ email: query.email }] : []), ...(query.phone ? [{ phone: query.phone }] : [])],
      },
      select: { id: true, firstName: true, surname: true, email: true },
    });

    if (!candidate) {
      return { found: false, id: null, firstName: null, surname: null, email: null };
    }
    return { found: true, id: candidate.id, firstName: candidate.firstName, surname: candidate.surname, email: candidate.email };
  }

  /** List a user's role grants — RLS shows the caller their own grants, or (as of this
   * phase) any grant scoped to a School they hold SCHOOL_OWNER_MANAGER on. */
  async findAllForUser(
    callerId: string,
    targetUserId: string,
    cursor?: string,
    limit?: number,
  ): Promise<CursorPage<{ id: string }>> {
    const page = await this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate((args) => tx.roleGrant.findMany({ ...args, where: { userId: targetUserId } }), cursor, limit),
    );
    // Resolved via PrismaAuthService (Decision 117), not a Prisma `include` on
    // RoleGrant.user — an RLS-scoped include can silently fail to resolve the
    // target's own User row once ALL their RoleGrants at this School are revoked
    // (this endpoint deliberately still returns revoked rows), even though this
    // caller is fully authorized to see those rows. See resolveUserNames's own
    // header comment. Every row shares the same targetUserId, so this lookup is
    // redundant per-row — accepted anyway to match the established per-DTO embed
    // convention (Decision 109/110) rather than a one-off envelope shape.
    const names = await resolveUserNames(this.prismaAuth, page.items.map((g) => g.userId));
    return {
      ...page,
      items: page.items.map((g) => ({
        ...g,
        userFirstName: names.get(g.userId)?.firstName ?? '',
        userSurname: names.get(g.userId)?.surname ?? '',
      })),
    };
  }

  /** Revoke = set revokedAt (soft — RoleGrant is an auditable history, never hard-deleted). */
  async revoke(callerId: string, targetUserId: string, roleGrantId: string) {
    const grant = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findUnique({ where: { id: roleGrantId } }),
    );
    if (!grant || grant.userId !== targetUserId) {
      throw new NotFoundException('RoleGrant not found');
    }
    if (!REVOCABLE_ROLES.includes(grant.role as (typeof REVOCABLE_ROLES)[number])) {
      throw new ForbiddenException('This endpoint may only revoke INSTRUCTOR, BRANCH_STAFF, or STUDENT grants.');
    }
    if (!grant.schoolId) {
      throw new ForbiddenException('This endpoint may only revoke School-scoped grants.');
    }
    await this.tenantAuth.assertSchoolOwner(callerId, grant.schoolId);

    if (grant.revokedAt) {
      return grant; // already revoked — idempotent, not an error
    }

    const schoolId = grant.schoolId;
    let freedClassIds: string[] = [];
    const revoked = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const row = await tx.roleGrant.update({ where: { id: roleGrantId }, data: { revokedAt: new Date() } });
      // Given the role again later, they start with today's permissions, not
      // their old ones (Decision 193). Cleared only once they hold no coach
      // role at this School, so losing one branch keeps the others' rights.
      const remaining = await tx.roleGrant.findMany({
        where: { userId: targetUserId, schoolId, revokedAt: null, role: { in: ['INSTRUCTOR', 'BRANCH_STAFF'] } },
        select: { role: true },
      });
      if (remaining.length === 0) await tx.gradingPermission.deleteMany({ where: { userId: targetUserId, schoolId } });
      if (!remaining.some((g) => g.role === 'BRANCH_STAFF')) {
        await tx.staffPermission.updateMany({ where: { userId: targetUserId, schoolId, canInviteCoaches: true }, data: { canInviteCoaches: false } });
      }
      // A home branch belongs to an enrolment (Decision 341, S13): left
      // behind, it blocked re-enrolling (one per School and student) and
      // archiving the branch (Decision 252). Re-enrolling picks one again.
      if (grant.role === 'STUDENT') {
        const stillEnrolled = await tx.roleGrant.count({ where: { userId: targetUserId, schoolId, role: 'STUDENT', revokedAt: null } });
        if (stillEnrolled === 0) {
          await tx.studentHomeBranch.deleteMany({ where: { schoolId, studentId: targetUserId } });
          // Someone who has left gives up their seats and waitlist places
          // (Decision 343, S2).
          ({ freedClassIds } = await cancelPlacesOfLeavingStudent(tx, schoolId, targetUserId, callerId, this.logger));
        }
      }
      return row;
    });
    // Branch Staff no longer at that branch can't have coach invites open
    // there (Decision 183; security review M1).
    if (grant.role === 'BRANCH_STAFF') await this.coachInvites.cancelOpenInvitesFrom(callerId, grant.schoolId, targetUserId, grant.branchId);
    // Enqueued after commit and only logged on failure, like cancelBooking():
    // a Redis hiccup must not undo the revoke.
    for (const classId of freedClassIds) {
      try {
        await this.waitlistCascadeQueue.add('seat-freed', { classId });
      } catch (err) {
        this.logger.warn(`Failed to enqueue waitlist-cascade-processing for Class ${classId} after revoking ${roleGrantId}: ${err}`);
      }
    }
    return revoked;
    // Same JWT-staleness caveat as create() above: an already-issued token keeps this
    // grant's claim until it expires (≤15 min) or is refreshed — there is no
    // session-invalidation mechanism yet (flagged, not silently assumed away).
  }
}
