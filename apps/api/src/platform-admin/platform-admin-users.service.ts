import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
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
 * FULL_ADMIN-only for BOTH create and list, mirroring ultm8-tenant-isolation
 * SKILL.md §3's one confirmed subRole restriction ("only Full Platform Admin
 * can assign sub-roles to other staff") — "who else has Platform Admin access"
 * is itself a meaningfully sensitive fact, closer in kind to assigning access
 * than to a routine support-facing read like GET /platform-admin/schools/:id
 * (which deliberately has no subRole restriction — see that service's own
 * comment for why). Uses AdminUser queries via the bare PrismaAppService
 * client, same as PlatformAdminAuthService — this table has no RLS policy at
 * all (Phase 1's own migration comment), so there's nothing for
 * ultm8_platform_admin's own additive policies to matter for here.
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
}
