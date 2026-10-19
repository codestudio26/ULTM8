import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminSubRole, Prisma } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { AuditLogService, AuditAction } from '../platform-admin/audit-log.service';
import { PublishLegalDocumentDto } from './dto/publish-legal-document.dto';
import { formatPolicyVersion } from './legal-policy-version';

/**
 * Decision 171 — publishing a new version of a legal document. Each publish adds a
 * LegalDocumentVersion (kept forever), makes it the document's current text, and is
 * audit-logged. Only existing documents can be published to (the seeded slugs);
 * this does not create new ones.
 *
 * FULL_ADMIN only, same as authoring Translations: no narrower confirmed sub-role
 * covers content authoring. assertFullAdmin() duplicates TranslationsService's own
 * private check, as that one duplicates PlatformAdminUsersService's.
 */
@Injectable()
export class LegalDocumentsAdminService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly auditLog: AuditLogService,
  ) {}

  private async assertFullAdmin(callerId: string): Promise<void> {
    const caller = await this.prismaApp.adminUser.findUnique({ where: { id: callerId } });
    if (!caller || caller.revokedAt || caller.subRole !== AdminSubRole.FULL_ADMIN) {
      throw new ForbiddenException('Only a Full Platform Admin may publish legal documents.');
    }
  }

  async publish(callerId: string, slug: string, dto: PublishLegalDocumentDto) {
    await this.assertFullAdmin(callerId);

    let published;
    try {
      published = await this.prismaApp.$transaction(async (tx) => {
        const doc = await tx.legalDocument.findUnique({ where: { slug } });
        if (!doc) {
          throw new NotFoundException('Legal document not found');
        }
        const version = (doc.currentVersion ?? 0) + 1;
        const title = dto.title ?? doc.title;
        const created = await tx.legalDocumentVersion.create({
          data: { slug, version, title, content: dto.content, publishedByAdminId: callerId },
        });
        await tx.legalDocument.update({
          where: { slug },
          data: { title, content: dto.content, currentVersion: version },
        });
        return created;
      });
    } catch (err) {
      // Two publishes of the same document at once both computed the same next
      // version; (slug, version) is unique, so the second one fails here.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Another version of this document was published at the same time. Reload and try again.');
      }
      throw err;
    }

    await this.auditLog.record({
      adminUserId: callerId,
      action: AuditAction.PUBLISH_LEGAL_DOCUMENT_VERSION,
      targetType: 'LegalDocument',
      targetId: slug,
      details: { version: published.version },
    });

    return { ...published, policyVersion: formatPolicyVersion(slug, published.version) };
  }
}
