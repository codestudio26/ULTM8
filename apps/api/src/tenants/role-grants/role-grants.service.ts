import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../../common/prisma/prisma-auth.service';
import { TenantAuthorizationService } from '../tenant-authorization.service';
import { CoachInvitesService } from '../coach-invites/coach-invites.service';
import { NotificationDeliveryService } from '../../notifications/notification-delivery.service';
import { cursorPaginate, CursorPage } from '../../common/pagination/cursor-paginate';
import { resolveUserNames } from '../../common/prisma/resolve-user-names';
import { CreateRoleGrantDto, GrantableRoleDto } from './dto/create-role-grant.dto';
import { LookupInviteCandidateQueryDto } from './dto/lookup-invite-candidate-query.dto';

/** The only two roles this endpoint is authorized to grant/revoke — see CreateRoleGrantDto. */
const GRANTABLE_ROLES = ['INSTRUCTOR', 'BRANCH_STAFF'] as const;

@Injectable()
export class RoleGrantsService {
  private readonly logger = new Logger(RoleGrantsService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly coachInvites: CoachInvitesService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  /**
   * School Owner/Manager granting Instructor or Branch Staff within their own School
   * (Spec §8.2) — the one confirmed case; see CreateRoleGrantDto's header comment for
   * why every other role/grantor combination is out of scope this phase.
   */
  async create(callerId: string, targetUserId: string, dto: CreateRoleGrantDto) {
    await this.tenantAuth.assertSchoolOwner(callerId, dto.schoolId);

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

    // Target user must exist — no verification precondition on the target as of
    // Decision 81 (see above). Uses PrismaAuthService (see its header comment) because
    // no shared RoleGrant exists yet to make the target visible via the ordinary
    // RLS-scoped path.
    // email/firstName/surname resolved here too — found on review, the same
    // "declared required by the DTO but never resolved" gap PR #160 already
    // fixed for Instructor (InstructorResponseDto's firstName/surname): this
    // method's own @ApiCreatedResponse declares RoleGrantResponseDto, which
    // requires userFirstName/userSurname, but it returned the raw RoleGrant
    // row — neither a column on that model. One query now covers both that
    // fix and the target's email for the new notification below.
    const targetUser = await this.prismaAuth.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, firstName: true, surname: true },
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

    if (dto.branchId) {
      const branch = await this.prismaApp.withTenantContext(callerId, (tx) =>
        tx.branch.findUnique({ where: { id: dto.branchId }, select: { id: true, schoolId: true } }),
      );
      if (!branch || branch.schoolId !== dto.schoolId) {
        throw new BadRequestException('branchId must reference a Branch belonging to schoolId');
      }
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
    const created = await this.prismaApp.withTenantContext(callerId, (tx) =>
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

    // v1.2 backend backlog ("Granting a role sends no notification today") —
    // email only (Postmark primary/SES fallback, already wired for every
    // other notification this codebase sends); SMS/WhatsApp both ruled out,
    // see that doc's own note. Same "don't fail the grant over a notification
    // side effect, tell the caller whether it actually went out" shape
    // CoachInvitesService.invite() already established — the RoleGrant above
    // is already durably committed by the time this runs.
    const roleLabel = dto.role === GrantableRoleDto.BRANCH_STAFF ? 'Branch Staff' : 'Instructor';
    const inviter = caller ? `${caller.firstName} ${caller.surname}` : 'Your school';
    let emailSent = true;
    try {
      await this.delivery.sendEmail(
        targetUser.email,
        `You've been granted the ${roleLabel} role at ${school.name}`,
        [
          `${inviter} has granted you the ${roleLabel} role at ${school.name} on ULTM8.`,
          '',
          "Sign in with your existing account to see it reflected — if you're already signed in, sign out and back in.",
        ].join('\n'),
      );
    } catch (err) {
      emailSent = false;
      this.logger.warn(`RoleGrant ${roleGrantId}: the notification email could not be sent — ${err instanceof Error ? err.message : String(err)}`);
    }

    return { ...created, userFirstName: targetUser.firstName, userSurname: targetUser.surname, emailSent };
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
    if (!GRANTABLE_ROLES.includes(grant.role as (typeof GRANTABLE_ROLES)[number])) {
      throw new ForbiddenException('This endpoint may only revoke INSTRUCTOR or BRANCH_STAFF grants.');
    }
    if (!grant.schoolId) {
      throw new ForbiddenException('This endpoint may only revoke School-scoped grants.');
    }
    await this.tenantAuth.assertSchoolOwner(callerId, grant.schoolId);

    if (grant.revokedAt) {
      return grant; // already revoked — idempotent, not an error
    }

    const schoolId = grant.schoolId;
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
      return row;
    });
    // Branch Staff no longer at that branch can't have coach invites open
    // there (Decision 183; security review M1).
    if (grant.role === 'BRANCH_STAFF') await this.coachInvites.cancelOpenInvitesFrom(callerId, grant.schoolId, targetUserId, grant.branchId);
    return revoked;
    // Same JWT-staleness caveat as create() above: an already-issued token keeps this
    // grant's claim until it expires (≤15 min) or is refreshed — there is no
    // session-invalidation mechanism yet (flagged, not silently assumed away).
  }
}
