import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../../common/prisma/prisma-auth.service';
import { TenantAuthorizationService } from '../tenant-authorization.service';
import { cursorPaginate, CursorPage } from '../../common/pagination/cursor-paginate';
import { CreateRoleGrantDto } from './dto/create-role-grant.dto';

/** The only two roles this endpoint is authorized to grant/revoke — see CreateRoleGrantDto. */
const GRANTABLE_ROLES = ['INSTRUCTOR', 'BRANCH_STAFF'] as const;

@Injectable()
export class RoleGrantsService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly tenantAuth: TenantAuthorizationService,
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
      tx.user.findUnique({ where: { id: callerId }, select: { phoneVerifiedAt: true } }),
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
    const targetUser = await this.prismaAuth.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    const school = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUnique({ where: { id: dto.schoolId }, select: { id: true } }),
    );
    if (!school) {
      throw new NotFoundException('School not found');
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
    return this.prismaApp.withTenantContext(callerId, (tx) =>
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
  }

  /** List a user's role grants — RLS shows the caller their own grants, or (as of this
   * phase) any grant scoped to a School they hold SCHOOL_OWNER_MANAGER on. */
  async findAllForUser(
    callerId: string,
    targetUserId: string,
    cursor?: string,
    limit?: number,
  ): Promise<CursorPage<{ id: string }>> {
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate(
        (args) => tx.roleGrant.findMany({ ...args, where: { userId: targetUserId } }),
        cursor,
        limit,
      ),
    );
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

    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.update({ where: { id: roleGrantId }, data: { revokedAt: new Date() } }),
    );
    // Same JWT-staleness caveat as create() above: an already-issued token keeps this
    // grant's claim until it expires (≤15 min) or is refreshed — there is no
    // session-invalidation mechanism yet (flagged, not silently assumed away).
  }
}
