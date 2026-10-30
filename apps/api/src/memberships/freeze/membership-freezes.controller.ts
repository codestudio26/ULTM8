import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { MembershipFreezesService } from './membership-freezes.service';
import {
  CreateMembershipFreezeDto,
  MembershipFreezeListQueryDto,
  MembershipFreezeResponseDto,
  MyFreezableMembershipListResponseDto,
  SchoolMembershipFreezeListResponseDto,
} from './dto/membership-freeze.dto';

/** Decision 404: freezing a membership. See MembershipFreezesService. */
@ApiTags('memberships')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class MembershipFreezesController {
  constructor(private readonly freezes: MembershipFreezesService) {}

  /** The School's owner freezes a membership straight away. */
  @ApiCreatedResponse({ type: MembershipFreezeResponseDto })
  @Post('schools/:schoolId/memberships/:membershipId/freezes')
  createByStaff(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: CreateMembershipFreezeDto,
  ) {
    return this.freezes.createByStaff(user.sub, schoolId, membershipId, dto);
  }

  /** The School's freezes and freeze requests (?status=REQUESTED for the ones waiting). Owner only. */
  @ApiOkResponse({ type: SchoolMembershipFreezeListResponseDto })
  @Get('schools/:schoolId/freezes')
  listForSchool(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Query() query: MembershipFreezeListQueryDto) {
    return this.freezes.listForSchool(user.sub, schoolId, query.status);
  }

  @ApiCreatedResponse({ type: MembershipFreezeResponseDto })
  @Post('schools/:schoolId/freezes/:id/approve')
  approve(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.freezes.approveRequest(user.sub, schoolId, id);
  }

  @ApiCreatedResponse({ type: MembershipFreezeResponseDto })
  @Post('schools/:schoolId/freezes/:id/decline')
  decline(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.freezes.declineRequest(user.sub, schoolId, id);
  }

  /** Staff end a freeze early: billing restarts today, the fee is kept. */
  @ApiCreatedResponse({ type: MembershipFreezeResponseDto })
  @Post('schools/:schoolId/freezes/:id/end')
  endByStaff(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.freezes.endByStaff(user.sub, schoolId, id);
  }

  /** A member, or the Guardian for a child, asks for a freeze. */
  @ApiCreatedResponse({ type: MembershipFreezeResponseDto })
  @Post('memberships/:membershipId/freeze-requests')
  request(@CurrentUser() user: JwtPayload, @Param('membershipId', ParseUUIDPipe) membershipId: string, @Body() dto: CreateMembershipFreezeDto) {
    return this.freezes.request(user.sub, membershipId, dto);
  }

  /** The caller's own memberships that can be frozen, and their children's. */
  @ApiOkResponse({ type: MyFreezableMembershipListResponseDto })
  @Get('memberships/freezes/me')
  listMine(@CurrentUser() user: JwtPayload) {
    return this.freezes.listMine(user.sub);
  }

  /** Withdraw a freeze request nobody has decided yet. */
  @ApiCreatedResponse({ type: MembershipFreezeResponseDto })
  @Post('freezes/:id/cancel')
  cancel(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.freezes.cancelRequest(user.sub, id);
  }

  /** The member ends their freeze early. */
  @ApiCreatedResponse({ type: MembershipFreezeResponseDto })
  @Post('freezes/:id/end')
  endByMember(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.freezes.endByMember(user.sub, id);
  }
}
