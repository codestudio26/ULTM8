import { Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { GuardianLinkConfirmationsService } from './guardian-link-confirmations.service';
import {
  GuardianLinkConfirmerListResponseDto,
  GuardianLinkConfirmerResponseDto,
  GuardianLinkListQueryDto,
  GuardianLinkResponseDto,
  SchoolGuardianLinkListResponseDto,
} from './dto/guardian-link-confirmation.dto';

// Decision 172 — a School confirming Guardian–minor links, and the owner choosing
// which staff may do it. See GuardianLinkConfirmationsService for the rules.
@ApiTags('guardian-link-confirmations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools/:schoolId')
export class GuardianLinkConfirmationsController {
  constructor(private readonly confirmations: GuardianLinkConfirmationsService) {}

  @ApiOkResponse({ type: SchoolGuardianLinkListResponseDto })
  @Get('guardian-links')
  findLinks(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Query() query: GuardianLinkListQueryDto) {
    return this.confirmations.findLinksForSchool(user.sub, schoolId, query.status);
  }

  @ApiCreatedResponse({ type: GuardianLinkResponseDto })
  @Post('guardian-links/:linkId/confirm')
  confirm(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Param('linkId') linkId: string) {
    return this.confirmations.confirm(user.sub, schoolId, linkId);
  }

  @ApiCreatedResponse({ type: GuardianLinkResponseDto })
  @Post('guardian-links/:linkId/unconfirm')
  unconfirm(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Param('linkId') linkId: string) {
    return this.confirmations.unconfirm(user.sub, schoolId, linkId);
  }

  @ApiOkResponse({ type: GuardianLinkConfirmerListResponseDto })
  @Get('guardian-link-confirmers')
  findConfirmers(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string) {
    return this.confirmations.findConfirmers(user.sub, schoolId);
  }

  @ApiOkResponse({ type: GuardianLinkConfirmerResponseDto })
  @Put('guardian-link-confirmers/:userId')
  addConfirmer(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Param('userId') userId: string) {
    return this.confirmations.addConfirmer(user.sub, schoolId, userId);
  }

  @ApiOkResponse()
  @Delete('guardian-link-confirmers/:userId')
  removeConfirmer(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Param('userId') userId: string) {
    return this.confirmations.removeConfirmer(user.sub, schoolId, userId);
  }
}
