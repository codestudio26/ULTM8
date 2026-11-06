import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { PlanWaitlistService } from './plan-waitlist.service';
import {
  PlanAvailabilityResponseDto,
  PlanWaitlistLeaveResponseDto,
  PlanWaitlistMemberDto,
  PlanWaitlistOwnerResponseDto,
  PlanWaitlistPlaceDto,
} from './plan-waitlist.dto';

/** Decision 316 item 5 / Decision 435 items 10-15: a full plan's waiting list. */
@ApiTags('memberships')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class PlanWaitlistController {
  constructor(private readonly waitlist: PlanWaitlistService) {}

  @ApiCreatedResponse({ type: PlanWaitlistPlaceDto })
  @Post('membership-plans/:id/waitlist')
  join(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PlanWaitlistMemberDto) {
    return this.waitlist.join(user.sub, id, dto.studentId);
  }

  @ApiOkResponse({ type: PlanWaitlistLeaveResponseDto })
  @Delete('membership-plans/:id/waitlist')
  leave(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Query() query: PlanWaitlistMemberDto) {
    return this.waitlist.leave(user.sub, id, query.studentId);
  }

  @ApiOkResponse({ type: PlanWaitlistOwnerResponseDto })
  @Get('membership-plans/:id/waitlist')
  list(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.waitlist.list(user.sub, id);
  }

  @ApiOkResponse({ type: PlanAvailabilityResponseDto })
  @Get('schools/:schoolId/plan-availability')
  availability(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Query() query: PlanWaitlistMemberDto) {
    return this.waitlist.availability(user.sub, schoolId, query.studentId);
  }
}
