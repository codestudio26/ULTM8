import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminSubRole, Role } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaPlatformAdminService } from '../common/prisma/prisma-platform-admin.service';
import { AuditAction, AuditLogService } from '../platform-admin/audit-log.service';
import { decodeDescCursor, encodeDescCursor, resolveLimit } from '../common/pagination/cursor-paginate';
import { WhatsNewQueryDto, WriteProductUpdateDto } from './dto/whats-new.dto';

/** Who reads "What's new": School owners and staff (Decision 318 item 3).
 * A Franchise Owner is an owner too. Students and Guardians never. */
const READER_ROLES: Role[] = [Role.SCHOOL_OWNER_MANAGER, Role.BRANCH_STAFF, Role.INSTRUCTOR, Role.FRANCHISE_OWNER];

/**
 * Decision 318 item 3: "What's new", written by ULTM8 HQ in Platform Admin,
 * shown to owners and staff in their language (English if a translation is
 * missing). Posts are platform-wide: nothing in them, or in how they are
 * read, is about any School, so no tenant data can leak through them.
 *
 * Writing is a Full Platform Admin's, like Translations (content authoring),
 * on Platform Admin's own connection, and every change is audit-logged.
 */
@Injectable()
export class WhatsNewService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaPlatformAdmin: PrismaPlatformAdminService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ---------------------------------------------------------------------------
  // The School Portal
  // ---------------------------------------------------------------------------

  async listForReader(callerId: string, query: WhatsNewQueryDto) {
    const staff = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.count({ where: { userId: callerId, revokedAt: null, role: { in: READER_ROLES } } }),
    );
    if (staff === 0) {
      throw new ForbiddenException("What's new is for School owners and staff.");
    }
    const take = resolveLimit(query.limit);
    let after: { sortValue: Date; id: string } | null = null;
    if (query.cursor) {
      try {
        after = decodeDescCursor(query.cursor);
      } catch {
        throw new BadRequestException('cursor is not valid');
      }
      if (Number.isNaN(after.sortValue.getTime())) throw new BadRequestException('cursor is not valid');
    }
    const locale = query.locale && query.locale !== 'en-GB' ? query.locale : null;
    const rows = await this.prismaApp.productUpdate.findMany({
      where: after ? { OR: [{ createdAt: { lt: after.sortValue } }, { createdAt: after.sortValue, id: { lt: after.id } }] } : undefined,
      include: { translations: { where: { locale: locale ?? '' } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map((p) => {
        const tr = p.translations[0];
        return { id: p.id, title: tr?.title ?? p.title, body: tr?.body ?? p.body, locale: tr ? tr.locale : 'en-GB', createdAt: p.createdAt };
      }),
      nextCursor: hasMore ? encodeDescCursor(last.createdAt, last.id) : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Platform Admin
  // ---------------------------------------------------------------------------

  /** Every post with its translations, newest first. Any admin may read. */
  async listForAdmin() {
    const items = await this.prismaPlatformAdmin.productUpdate.findMany({
      include: { translations: { select: { locale: true, title: true, body: true }, orderBy: { locale: 'asc' } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return { items };
  }

  async create(adminUserId: string, dto: WriteProductUpdateDto) {
    await this.assertFullAdmin(adminUserId);
    const translations = this.checkTranslations(dto);
    const created = await this.prismaPlatformAdmin.productUpdate.create({
      data: { title: dto.title, body: dto.body, createdById: adminUserId, translations: { create: translations } },
      include: { translations: { select: { locale: true, title: true, body: true }, orderBy: { locale: 'asc' } } },
    });
    await this.auditLog.record({ adminUserId, action: AuditAction.CREATE_PRODUCT_UPDATE, targetType: 'ProductUpdate', targetId: created.id });
    return created;
  }

  async update(adminUserId: string, id: string, dto: WriteProductUpdateDto) {
    await this.assertFullAdmin(adminUserId);
    const translations = this.checkTranslations(dto);
    const updated = await this.prismaPlatformAdmin.$transaction(async (tx) => {
      const found = await tx.productUpdate.findUnique({ where: { id }, select: { id: true } });
      if (!found) throw new NotFoundException('Post not found');
      if (dto.translations !== undefined) {
        await tx.productUpdateTranslation.deleteMany({ where: { productUpdateId: id } });
      }
      return tx.productUpdate.update({
        where: { id },
        data: { title: dto.title, body: dto.body, ...(dto.translations !== undefined ? { translations: { create: translations } } : {}) },
        include: { translations: { select: { locale: true, title: true, body: true }, orderBy: { locale: 'asc' } } },
      });
    });
    await this.auditLog.record({ adminUserId, action: AuditAction.UPDATE_PRODUCT_UPDATE, targetType: 'ProductUpdate', targetId: id });
    return updated;
  }

  async remove(adminUserId: string, id: string): Promise<void> {
    await this.assertFullAdmin(adminUserId);
    const { count } = await this.prismaPlatformAdmin.productUpdate.deleteMany({ where: { id } });
    if (count === 0) throw new NotFoundException('Post not found');
    await this.auditLog.record({ adminUserId, action: AuditAction.DELETE_PRODUCT_UPDATE, targetType: 'ProductUpdate', targetId: id });
  }

  /** One translation per language. */
  private checkTranslations(dto: WriteProductUpdateDto) {
    const list = dto.translations ?? [];
    if (new Set(list.map((t) => t.locale)).size !== list.length) {
      throw new BadRequestException('Give each language once.');
    }
    return list.map((t) => ({ locale: t.locale, title: t.title, body: t.body }));
  }

  private async assertFullAdmin(adminUserId: string): Promise<void> {
    const caller = await this.prismaApp.adminUser.findUnique({ where: { id: adminUserId } });
    if (!caller || caller.revokedAt || caller.subRole !== AdminSubRole.FULL_ADMIN) {
      throw new ForbiddenException("Only a Full Platform Admin may write What's new posts.");
    }
  }
}
