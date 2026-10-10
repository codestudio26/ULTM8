import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, AdminSubRole } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { AuditLogService, AuditAction } from './audit-log.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';

/**
 * FOUND ON REVIEW: a first draft called `adminUser.create`/`findMany` with no
 * explicit `select`, so Prisma returned every scalar column — including
 * `ssoSubject` — straight through the controller, since this codebase has no
 * global `ClassSerializerInterceptor` to strip fields based on
 * AdminUserResponseDto's TypeScript shape alone (that type has no runtime
 * effect on what actually gets serialized). Same lesson
 * PLATFORM_ADMIN_SCHOOL_SELECT already recorded in this exact module: an
 * explicit, named `select` matching the response DTO is required, not
 * optional, whenever a response DTO promises a field is excluded.
 */
const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  subRole: true,
  createdAt: true,
  updatedAt: true,
  revokedAt: true,
  // Deliberately excluded: ssoSubject — see this constant's own header comment
  // and AdminUserResponseDto's own comment for why.
} as const;

/**
 * PlatformAdminModule's first WRITE-side endpoint — Slice 4 (Phase 28): a
 * FULL_ADMIN-run successor to scripts/bootstrap-admin-user.ts, for every admin
 * after the very first one. Not guessed at — the mechanics here were already
 * fully reasoned through during Phase 25's own kickoff (the bootstrap script's
 * own header comment records the same "identity and authorization are two
 * separate steps" design this reuses); this slice was deferred purely for
 * "small, reviewable slice" discipline, not because anything about it was
 * actually unresolved.
 *
 * FULL_ADMIN-only for create/list/revoke, mirroring ultm8-tenant-isolation
 * SKILL.md §3's one confirmed subRole restriction ("only Full Platform Admin
 * can assign sub-roles to other staff") — "who else has Platform Admin access"
 * is itself a meaningfully sensitive fact, closer in kind to assigning access
 * than to a routine support-facing read like GET /platform-admin/schools/:id
 * (which deliberately has no subRole restriction — see that service's own
 * comment for why). Uses AdminUser queries via the bare PrismaAppService
 * client, same as PlatformAdminAuthService — this table has no RLS policy at
 * all (Phase 1's own migration comment), so there's nothing for
 * ultm8_platform_admin's own additive policies to matter for here.
 *
 * revoke() — Slice 5 (Phase 29): the other half of the AdminUser lifecycle
 * Slice 4 started. Confirmed by Spec §4.4 ("access revoked immediately" on
 * offboarding) — soft, via `revokedAt`, same idempotent-revoke shape
 * RoleGrantsService.revoke() already established for the tenant side (already
 * revoked → return as-is, not an error, since AdminUser rows are never hard-
 * deleted any more than RoleGrant rows are). One safety invariant added here
 * that has no tenant-side analogue: revoking the LAST active FULL_ADMIN is
 * refused outright, because assertFullAdmin() above gates every write in this
 * service (including revoke itself) — losing the last FULL_ADMIN would
 * permanently lock the whole admin-management surface behind the emergency
 * bootstrap script. This is an availability/lockout safeguard, not an
 * invented business rule about who may be revoked or by whom — the spec's own
 * confirmed rule (revocation happens, immediately) is unaffected; only the
 * degenerate "revoke the only person who could ever revoke again" case is
 * blocked. Self-revocation is otherwise allowed (a FULL_ADMIN stepping down
 * after handing off duties to another still-active FULL_ADMIN is legitimate
 * and not guarded against). The count-then-update pair is a write-skew hazard
 * under plain READ COMMITTED — see revoke()'s own inline comment for the
 * Postgres advisory lock this uses to close it.
 */
@Injectable()
export class PlatformAdminUsersService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly auditLog: AuditLogService,
  ) {}

  private async assertFullAdmin(callerId: string): Promise<void> {
    const caller = await this.prismaApp.adminUser.findUnique({ where: { id: callerId } });
    if (!caller || caller.revokedAt || caller.subRole !== AdminSubRole.FULL_ADMIN) {
      throw new ForbiddenException('Only a Full Platform Admin may manage other Platform Admin accounts.');
    }
  }

  async create(callerId: string, dto: CreateAdminUserDto) {
    await this.assertFullAdmin(callerId);

    let created;
    try {
      created = await this.prismaApp.adminUser.create({
        data: { email: dto.email, name: dto.name, subRole: dto.subRole, ssoSubject: dto.ssoSubject },
        select: ADMIN_USER_SELECT,
      });
    } catch (err) {
      // email and ssoSubject are both @unique — a raw client could send either
      // already-taken, and a plain 500 would be wrong for a caller-supplied
      // conflict. Same P2002-detection convention this codebase already uses
      // elsewhere (e.g. bookings.service.ts's and waivers.service.ts's own
      // isUniqueConstraintViolation) — this uses an `instanceof` check instead
      // of that helper's duck-typing, which is equally valid for the same code.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('An AdminUser with this email or ssoSubject already exists.');
      }
      throw err;
    }

    // "Assigning sub-roles to other staff" (§3) is Platform Admin's own internal
    // roster, not tenant data — schoolId/franchiseId are correctly both null,
    // not omitted, so this is still a genuine, queryable audit entry rather
    // than silently skipped for not fitting the "on which tenant" shape.
    await this.auditLog.record({
      adminUserId: callerId,
      action: AuditAction.CREATE_ADMIN_USER,
      targetType: 'AdminUser',
      targetId: created.id,
    });

    return created;
  }

  async findAll(callerId: string) {
    await this.assertFullAdmin(callerId);
    const items = await this.prismaApp.adminUser.findMany({
      orderBy: { createdAt: 'asc' },
      select: ADMIN_USER_SELECT,
    });

    // "Who else has Platform Admin access" is itself a meaningfully sensitive
    // fact (see this service's own header comment on why this route is
    // FULL_ADMIN-only in the first place) — audited on every successful list,
    // same as PlatformAdminSchoolsService.findOne() audits every successful
    // view of a School, not only writes.
    await this.auditLog.record({
      adminUserId: callerId,
      action: AuditAction.LIST_ADMIN_USERS,
      targetType: 'AdminUser',
      targetId: 'ALL',
    });

    return items;
  }

  async revoke(callerId: string, targetAdminId: string) {
    await this.assertFullAdmin(callerId);

    const target = await this.prismaApp.adminUser.findUnique({
      where: { id: targetAdminId },
      select: { id: true, revokedAt: true, subRole: true },
    });
    if (!target) {
      throw new NotFoundException('AdminUser not found');
    }

    if (target.revokedAt) {
      // Idempotent, not an error — same convention RoleGrantsService.revoke()
      // already established for the tenant side. Re-fetched through
      // ADMIN_USER_SELECT (the response shape) rather than `target`, which
      // was only ever fetched with the narrow {id, revokedAt, subRole}
      // projection this check needs.
      return this.prismaApp.adminUser.findUniqueOrThrow({ where: { id: targetAdminId }, select: ADMIN_USER_SELECT });
    }

    // FOUND ON REVIEW: a first draft ran the "how many OTHER active
    // FULL_ADMINs exist" count() and the revoking update() as two separate,
    // unserialized statements. Under Postgres's default READ COMMITTED, two
    // concurrent revoke() calls targeting two DIFFERENT FULL_ADMINs — where
    // those two are the only active FULL_ADMINs left — can each see "1 other
    // active FULL_ADMIN" and both proceed, leaving zero: a genuine write-skew
    // race, not closed by merely wrapping both statements in one transaction
    // (READ COMMITTED doesn't re-validate an overlapping read at commit time;
    // this specifically needs SERIALIZABLE isolation or an explicit lock).
    // Fixed with a Postgres advisory lock scoped to this exact invariant —
    // acquired for the transaction's lifetime, so two concurrent FULL_ADMIN
    // revokes are forced to run one after the other, and the second one's
    // count() genuinely reflects the first one's already-committed revoke.
    const updated = await this.prismaApp.$transaction(async (tx) => {
      if (target.subRole === AdminSubRole.FULL_ADMIN) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('platform_admin_full_admin_revoke'))`;

        const otherActiveFullAdmins = await tx.adminUser.count({
          where: { subRole: AdminSubRole.FULL_ADMIN, revokedAt: null, id: { not: targetAdminId } },
        });
        if (otherActiveFullAdmins === 0) {
          // See this service's own header comment — an availability
          // safeguard, not an invented business rule about who may be
          // revoked. Thrown inside the transaction callback: Prisma rolls
          // back and rethrows the original error unmodified, so this still
          // reaches NestJS's exception filter as a clean 409.
          throw new ConflictException(
            'Cannot revoke the last active Full Platform Admin — this would permanently lock the admin-management surface.',
          );
        }
      }

      return tx.adminUser.update({
        where: { id: targetAdminId },
        data: { revokedAt: new Date() },
        select: ADMIN_USER_SELECT,
      });
    });

    await this.auditLog.record({
      adminUserId: callerId,
      action: AuditAction.REVOKE_ADMIN_USER,
      targetType: 'AdminUser',
      targetId: updated.id,
    });

    return updated;
  }
}
