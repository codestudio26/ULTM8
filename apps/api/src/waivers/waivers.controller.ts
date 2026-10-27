import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { WaiversService } from './waivers.service';
import { CreateWaiverDto } from './dto/create-waiver.dto';
import { UpdateWaiverDto } from './dto/update-waiver.dto';
import { SignWaiverDto } from './dto/sign-waiver.dto';
import { RequestSignatureUploadUrlDto } from './dto/request-signature-upload-url.dto';
import { WaiverListResponseDto, WaiverResponseDto } from './dto/waiver-response.dto';
import { WaiverSignatureListResponseDto, WaiverSignatureResponseDto } from './dto/waiver-signature-response.dto';
import { SignatureUploadUrlResponseDto } from './dto/signature-upload-url-response.dto';
import { WaiversQueryDto } from './dto/waivers-query.dto';
import { PaperSignatureUploadUrlDto, RecordPaperSignatureDto, RemindResponseDto } from './dto/paper-signature.dto';
import { UpdateWaiverSettingsDto, WaiverSettingsDto } from './dto/waiver-settings.dto';

// Waiver CRUD + Student self-signing (typed name, or typed name + drawn-signature
// capture as of Phase 34), plus Guardian-on-behalf-of-a-linked-minor signing as
// of Phase 37 — no Booking-time enforcement here (bookClass() checks
// WaiverSignature directly). See the Phase 10 kickoff prompt for the full
// original scoping rationale and WaiversService's own header comment for what
// Phase 34/37 each added.
@ApiTags('waivers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class WaiversController {
  constructor(private readonly waiversService: WaiversService) {}

  @ApiCreatedResponse({ type: WaiverResponseDto })
  @Post('schools/:schoolId/waivers')
  createWaiver(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Body() dto: CreateWaiverDto,
  ) {
    return this.waiversService.createWaiver(user.sub, schoolId, dto);
  }

  @ApiOkResponse({ type: WaiverListResponseDto })
  @Get('schools/:schoolId/waivers')
  findAllWaivers(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Query() query: WaiversQueryDto,
  ) {
    return this.waiversService.findAllWaivers(user.sub, schoolId, query.cursor, query.limit, query.includeArchived);
  }

  /** v1.2 backend backlog — the Waivers page's "Signatures" panel. See
   * WaiversService.findSignaturesForWaiver's own header comment. */
  @ApiOkResponse({ type: WaiverSignatureListResponseDto })
  @ApiQuery({ name: 'cursor', required: false, description: 'nextCursor from the previous page.' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @Get('schools/:schoolId/waivers/:id/signatures')
  findSignatures(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.waiversService.findSignaturesForWaiver(user.sub, schoolId, id, query.cursor, query.limit);
  }

  /** One signature with the text as it was signed (Waivers review W3). */
  @ApiOkResponse({ type: WaiverSignatureResponseDto })
  @Get('schools/:schoolId/waivers/:id/signatures/:signatureId')
  findSignature(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Param('id') id: string,
    @Param('signatureId') signatureId: string,
  ) {
    return this.waiversService.findSignatureForWaiver(user.sub, schoolId, id, signatureId);
  }

  // NOTE ordering: 'waivers/me' MUST be registered before 'waivers/:id' — both
  // share the same path prefix, and NestJS/Express resolves routes in
  // registration order, so a static segment declared after a param route would
  // never be reached (a request to /waivers/me would incorrectly match :id='me').
  // Caught before this ever ran, not found via a failing test.
  /** Decision 354: the School's Waiver settings (Owner/Manager only). */
  @ApiOkResponse({ type: WaiverSettingsDto })
  @Get('schools/:schoolId/waiver-settings')
  getWaiverSettings(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string) {
    return this.waiversService.getWaiverSettings(user.sub, schoolId);
  }

  @ApiOkResponse({ type: WaiverSettingsDto })
  @Patch('schools/:schoolId/waiver-settings')
  updateWaiverSettings(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Body() dto: UpdateWaiverSettingsDto) {
    return this.waiversService.updateWaiverSettings(user.sub, schoolId, dto);
  }

  /** Decision 354: remind current students who haven't signed (each at most once a day). */
  @ApiCreatedResponse({ type: RemindResponseDto })
  @Post('schools/:schoolId/waivers/:id/remind')
  remind(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Param('id') id: string) {
    return this.waiversService.remind(user.sub, schoolId, id);
  }

  /** Decision 354: record a waiver signed on paper, step 1 (upload the photo). */
  @ApiCreatedResponse({ type: SignatureUploadUrlResponseDto })
  @Post('schools/:schoolId/waivers/:id/signatures/:signatureId/paper-upload-url')
  requestPaperUploadUrl(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Param('id') id: string,
    @Param('signatureId') signatureId: string,
    @Body() dto: PaperSignatureUploadUrlDto,
  ) {
    return this.waiversService.requestPaperUploadUrl(user.sub, schoolId, id, signatureId, dto);
  }

  /** Step 2: mark the entry Signed on paper. */
  @ApiCreatedResponse({ type: WaiverSignatureResponseDto })
  @Post('schools/:schoolId/waivers/:id/signatures/:signatureId/paper')
  recordPaperSignature(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Param('id') id: string,
    @Param('signatureId') signatureId: string,
    @Body() dto: RecordPaperSignatureDto,
  ) {
    return this.waiversService.recordPaperSignature(user.sub, schoolId, id, signatureId, dto);
  }

  @ApiOkResponse({ type: WaiverSignatureListResponseDto })
  @Get('waivers/me')
  findMySignatures(@CurrentUser() user: JwtPayload, @Query() query: PaginationQueryDto) {
    return this.waiversService.findMySignatures(user.sub, query.cursor, query.limit);
  }

  @ApiOkResponse({ type: WaiverResponseDto })
  @Get('waivers/:id')
  findOneWaiver(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.waiversService.findOneWaiver(user.sub, id);
  }

  @ApiOkResponse({ type: WaiverResponseDto })
  @Patch('waivers/:id')
  updateWaiver(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateWaiverDto) {
    return this.waiversService.updateWaiver(user.sub, id, dto);
  }

  /** Decision 226 — School Owner/Manager only, idempotent. Always allowed
   * since Decision 354 (W2); signatures stay. */
  @ApiOkResponse({ type: WaiverResponseDto })
  @Post('waivers/:id/archive')
  archiveWaiver(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.waiversService.archiveWaiver(user.sub, id);
  }

  @ApiOkResponse({ type: WaiverResponseDto })
  @Post('waivers/:id/unarchive')
  unarchiveWaiver(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.waiversService.unarchiveWaiver(user.sub, id);
  }

  @ApiCreatedResponse({ type: WaiverSignatureResponseDto })
  @Post('waivers/:id/sign')
  sign(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: SignWaiverDto) {
    return this.waiversService.sign(user.sub, id, dto);
  }

  @ApiCreatedResponse({ type: SignatureUploadUrlResponseDto })
  @Post('waivers/:id/signature-upload-url')
  requestSignatureUploadUrl(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RequestSignatureUploadUrlDto,
  ) {
    return this.waiversService.requestSignatureUploadUrl(user.sub, id, dto);
  }
}
