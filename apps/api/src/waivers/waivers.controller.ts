import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { WaiversService } from './waivers.service';
import { CreateWaiverDto } from './dto/create-waiver.dto';
import { UpdateWaiverDto } from './dto/update-waiver.dto';
import { SignWaiverDto } from './dto/sign-waiver.dto';
import { WaiverListResponseDto, WaiverResponseDto } from './dto/waiver-response.dto';
import { WaiverSignatureListResponseDto, WaiverSignatureResponseDto } from './dto/waiver-signature-response.dto';

// Waiver CRUD + Student self-signing only this phase — no Guardian-signing, no
// drawn-signature capture, no Booking-time enforcement. See the Phase 10 kickoff
// prompt for the full scoping rationale.
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
    @Query() query: PaginationQueryDto,
  ) {
    return this.waiversService.findAllWaivers(user.sub, schoolId, query.cursor, query.limit);
  }

  // NOTE ordering: 'waivers/me' MUST be registered before 'waivers/:id' — both
  // share the same path prefix, and NestJS/Express resolves routes in
  // registration order, so a static segment declared after a param route would
  // never be reached (a request to /waivers/me would incorrectly match :id='me').
  // Caught before this ever ran, not found via a failing test.
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

  @ApiCreatedResponse({ type: WaiverSignatureResponseDto })
  @Post('waivers/:id/sign')
  sign(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: SignWaiverDto) {
    return this.waiversService.sign(user.sub, id, dto);
  }
}
