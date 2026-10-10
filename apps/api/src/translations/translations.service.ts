import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, AdminSubRole } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { AuditLogService, AuditAction } from '../platform-admin/audit-log.service';
import { cursorPaginate } from '../common/pagination/cursor-paginate';
import { CreateTranslationDto } from './dto/create-translation.dto';
import { UpdateTranslationDto } from './dto/update-translation.dto';

const CONFLICT_MESSAGE = 'A Translation with this screen/labelKey/locale already exists.';

/**
 * TranslationsModule (Phase 49, ultm8-nestjs-module §5) — one service backs both
 * the public read surface and the Platform-Admin-gated CRUD, deliberately NOT split
 * into two services the way School has SchoolsService/PlatformAdminSchoolsService.
 * That split exists there because the admin side needs an RLS-bypass read mechanism
 * the tenant side doesn't have; Translation has no RLS at all (see schema.prisma's
 * own model comment), so both surfaces hit the exact same unfiltered table through
 * the same PrismaAppService client. Flagged as a deliberate, reasoned deviation from
 * the "one service per realm" convention, not an oversight.
 *
 * No separate admin "list" endpoint exists — findAll() below is unauthenticated and
 * already unfiltered, so the future apps/platform-admin authoring UI (not built this
 * phase) can call the same public GET /translations to browse before editing.
 * Building a second, duplicate list endpoint under platform-admin/translations would
 * be pure duplication for zero new capability — flagged as a reasonable-minimum
 * scope call, same treatment other such calls get in this codebase.
 *
 * assertFullAdmin() is a local duplicate of PlatformAdminUsersService's own check
 * (that one is `private`, so it can't be imported/reused) — FULL_ADMIN-only because
 * no narrower confirmed sub-role fits "content authoring" (SUPPORT and
 * BILLING_PAYMENTS_OPS are both scoped to clearly different concerns per
 * ultm8-tenant-isolation §3). Same safe-default reasoning
 * PlatformAdminUsersService.assertFullAdmin() already uses for its own
 * no-narrower-tier-confirmed case — flagged here too for Architect review rather
 * than silently assumed final.
 */
@Injectable()
export class TranslationsService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findAll(screen: string | undefined, locale: string | undefined, cursor: string | undefined, limit: number | undefined) {
    const where: Prisma.TranslationWhereInput = {
      ...(screen ? { screen } : {}),
      ...(locale ? { locale } : {}),
    };
    return cursorPaginate((args) => this.prismaApp.translation.findMany({ ...args, where }), cursor, limit);
  }

  private async assertFullAdmin(callerId: string): Promise<void> {
    const caller = await this.prismaApp.adminUser.findUnique({ where: { id: callerId } });
    if (!caller || caller.revokedAt || caller.subRole !== AdminSubRole.FULL_ADMIN) {
      throw new ForbiddenException('Only a Full Platform Admin may author Translations.');
    }
  }

  async create(callerId: string, dto: CreateTranslationDto) {
    await this.assertFullAdmin(callerId);

    let created;
    try {
      created = await this.prismaApp.translation.create({ data: dto });
    } catch (err) {
      // (screen, labelKey, locale) is a real @@unique index (see the migration's own
      // comment) — a raw client could send an already-taken triple, and the global
      // HttpExceptionFilter's generic P2002 fallback message ("A record with this
      // value already exists.") is less specific than this codebase's own established
      // convention of naming the actual conflicting fields (same reasoning
      // PlatformAdminUsersService.create()'s own manual P2002 catch already gives).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(CONFLICT_MESSAGE);
      }
      throw err;
    }

    // Non-tenant, Platform-Admin-authored content — same "who changed what" audit
    // trail PlatformAdminUsersService already keeps for AdminUser create/revoke
    // (also non-tenant data), schoolId/franchiseId both correctly omitted rather
    // than guessed at.
    await this.auditLog.record({
      adminUserId: callerId,
      action: AuditAction.CREATE_TRANSLATION,
      targetType: 'Translation',
      targetId: created.id,
    });

    return created;
  }

  async update(callerId: string, id: string, dto: UpdateTranslationDto) {
    await this.assertFullAdmin(callerId);

    let updated;
    try {
      // No manual findUnique-then-branch dance here, unlike
      // PlatformAdminUsersService.revoke() — that exists there for idempotency and
      // a last-FULL_ADMIN lockout count, neither of which applies to a plain CRUD
      // entity. Prisma's own P2025 on a nonexistent id is already mapped to a
      // generic 404 by the global HttpExceptionFilter, so a bare update() is
      // sufficient — this catch exists only to give P2002 (a caller moving the row
      // onto an already-taken screen/labelKey/locale triple) the same specific
      // message create() gives.
      updated = await this.prismaApp.translation.update({ where: { id }, data: dto });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(CONFLICT_MESSAGE);
      }
      throw err;
    }

    await this.auditLog.record({
      adminUserId: callerId,
      action: AuditAction.UPDATE_TRANSLATION,
      targetType: 'Translation',
      targetId: updated.id,
    });

    return updated;
  }

  async delete(callerId: string, id: string) {
    await this.assertFullAdmin(callerId);

    // No manual existence check — same reasoning as update() above. A P2025 on a
    // nonexistent id is already a clean 404 via the global filter.
    const deleted = await this.prismaApp.translation.delete({ where: { id } });

    await this.auditLog.record({
      adminUserId: callerId,
      action: AuditAction.DELETE_TRANSLATION,
      targetType: 'Translation',
      targetId: deleted.id,
    });

    return deleted;
  }
}
