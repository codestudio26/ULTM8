import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { SignedDocumentsExportService } from './signed-documents-export.service';
import {
  CreateSignedDocumentExportDto,
  LatestSignedDocumentExportDto,
  SignedDocumentExportDownloadDto,
  SignedDocumentExportDto,
} from './dto/signed-documents.dto';

/**
 * Export all signed documents (Decision 315 item 13): a ZIP of every signed
 * waiver at the School, with an index. School owners only.
 */
@ApiTags('signed-documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools/:schoolId/signed-documents/exports')
export class SignedDocumentsExportController {
  constructor(private readonly exports: SignedDocumentsExportService) {}

  /** Start an export (or get the one already being made). Poll it until READY. */
  @ApiCreatedResponse({ type: SignedDocumentExportDto })
  @Post()
  request(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() body: CreateSignedDocumentExportDto) {
    return this.exports.request(user.sub, schoolId, body.labels);
  }

  /** The School's most recent export, if any. */
  @ApiOkResponse({ type: LatestSignedDocumentExportDto })
  @Get('latest')
  latest(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.exports.latest(user.sub, schoolId);
  }

  @ApiOkResponse({ type: SignedDocumentExportDto })
  @Get(':exportId')
  get(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('exportId', ParseUUIDPipe) exportId: string) {
    return this.exports.get(user.sub, schoolId, exportId);
  }

  /** A link that downloads the ZIP for the next 5 minutes. */
  @ApiOkResponse({ type: SignedDocumentExportDownloadDto })
  @Get(':exportId/download')
  download(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('exportId', ParseUUIDPipe) exportId: string) {
    return this.exports.downloadUrl(user.sub, schoolId, exportId);
  }
}
