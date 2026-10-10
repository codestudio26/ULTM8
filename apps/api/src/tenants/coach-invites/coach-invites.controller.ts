import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { CoachInvitesService } from './coach-invites.service';
import {
  AcceptCoachInviteResponseDto,
  CoachInviteListResponseDto,
  CoachInvitePreviewDto,
  CoachInviteResponseDto,
  CreateCoachInviteDto,
  CreatedCoachInviteResponseDto,
  SetStaffPermissionDto,
  StaffPermissionListResponseDto,
  StaffPermissionResponseDto,
} from './dto/coach-invite.dto';

/** Coach invites and "Can invite coaches" (Decision 183). */
@ApiTags('coach-invites')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class CoachInvitesController {
  constructor(private readonly coachInvites: CoachInvitesService) {}

  @ApiCreatedResponse({ type: CreatedCoachInviteResponseDto })
  @Post('schools/:schoolId/coach-invites')
  create(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: CreateCoachInviteDto) {
    return this.coachInvites.create(user.sub, schoolId, dto);
  }

  @ApiOkResponse({ type: CoachInviteListResponseDto })
  @Get('schools/:schoolId/coach-invites')
  list(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.coachInvites.list(user.sub, schoolId);
  }

  @ApiCreatedResponse({ type: CoachInviteResponseDto })
  @Post('coach-invites/:id/cancel')
  cancel(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.coachInvites.cancel(user.sub, id);
  }

  @ApiCreatedResponse({ type: AcceptCoachInviteResponseDto })
  @Post('coach-invite-links/:token/accept')
  accept(@CurrentUser() user: JwtPayload, @Param('token') token: string) {
    return this.coachInvites.accept(user.sub, token);
  }

  @ApiOkResponse({ type: StaffPermissionListResponseDto })
  @Get('schools/:schoolId/staff-permissions')
  listStaffPermissions(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.coachInvites.listStaffPermissions(user.sub, schoolId);
  }

  @ApiOkResponse({ type: StaffPermissionResponseDto })
  @Put('schools/:schoolId/staff-permissions/:userId')
  setStaffPermission(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetStaffPermissionDto,
  ) {
    return this.coachInvites.setStaffPermission(user.sub, schoolId, userId, dto.canInviteCoaches);
  }
}

/** The invite page before sign-in: no token needed, only the link's own. */
@ApiTags('coach-invites')
@Controller()
export class CoachInviteLinksController {
  constructor(private readonly coachInvites: CoachInvitesService) {}

  @ApiOkResponse({ type: CoachInvitePreviewDto })
  @Get('coach-invite-links/:token')
  preview(@Param('token') token: string) {
    return this.coachInvites.preview(token);
  }
}
