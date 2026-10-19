import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { PlatformAdminJwtAuthGuard } from '../platform-admin/guards/platform-admin-jwt-auth.guard';
import { CurrentAdminUser } from '../platform-admin/decorators/current-admin-user.decorator';
import { AdminJwtPayload } from '../platform-admin/interfaces/admin-jwt-payload.interface';
import { LegalDocumentsAdminService } from './legal-documents-admin.service';
import { LegalDocumentVersionResponseDto, PublishLegalDocumentDto } from './dto/publish-legal-document.dto';

/** Decision 171 — the write half of legal documents, under `platform-admin/*` like
 * every other Platform Admin controller. The read half stays public:
 * GET /legal/{doc} in SettingsController. */
@ApiTags('platform-admin-legal-documents')
@ApiBearerAuth()
@UseGuards(PlatformAdminJwtAuthGuard)
@Controller('platform-admin/legal-documents')
export class PlatformAdminLegalDocumentsController {
  constructor(private readonly legalDocuments: LegalDocumentsAdminService) {}

  @ApiCreatedResponse({ type: LegalDocumentVersionResponseDto })
  @Post(':slug/versions')
  publish(@CurrentAdminUser() admin: AdminJwtPayload, @Param('slug') slug: string, @Body() dto: PublishLegalDocumentDto) {
    return this.legalDocuments.publish(admin.sub, slug, dto);
  }
}
