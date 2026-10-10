import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { MembershipsService } from './memberships.service';
import { CreateMembershipPlanDto } from './dto/create-membership-plan.dto';
import { UpdateMembershipPlanDto } from './dto/update-membership-plan.dto';
import { PurchaseMembershipDto } from './dto/purchase-membership.dto';
import { MembershipPlanListResponseDto, MembershipPlanResponseDto } from './dto/membership-plan-response.dto';
import {
  MembershipListResponseDto,
  MembershipStatusResponseDto,
  PurchaseMembershipResponseDto,
} from './dto/membership-response.dto';

// MembershipPlan CRUD + purchase (self-service, or Guardian-on-behalf-of a linked
// minor as of Phase 39) + Student/Staff reads — no refund, no credit-restore, no
// invoice download, no franchise-fees, no Stripe dispute handling. See the Phase 9
// kickoff prompt for the full scoping rationale.
@ApiTags('memberships')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @ApiCreatedResponse({ type: MembershipPlanResponseDto })
  @Post('schools/:schoolId/membership-plans')
  createPlan(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Body() dto: CreateMembershipPlanDto,
  ) {
    return this.membershipsService.createPlan(user.sub, schoolId, dto);
  }

  @ApiOkResponse({ type: MembershipPlanListResponseDto })
  @Get('schools/:schoolId/membership-plans')
  findAllPlans(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.membershipsService.findAllPlans(user.sub, schoolId, query.cursor, query.limit);
  }

  @ApiOkResponse({ type: MembershipPlanResponseDto })
  @Get('membership-plans/:id')
  findOnePlan(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.membershipsService.findOnePlan(user.sub, id);
  }

  @ApiOkResponse({ type: MembershipPlanResponseDto })
  @Patch('membership-plans/:id')
  updatePlan(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateMembershipPlanDto) {
    return this.membershipsService.updatePlan(user.sub, id, dto);
  }

  @ApiOkResponse({ type: PurchaseMembershipResponseDto })
  @Post('membership-plans/:id/purchase')
  purchase(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: PurchaseMembershipDto) {
    return this.membershipsService.purchase(user.sub, id, dto);
  }

  @ApiOkResponse({ type: MembershipListResponseDto })
  @Get('memberships/me')
  findMyMemberships(@CurrentUser() user: JwtPayload, @Query() query: PaginationQueryDto) {
    return this.membershipsService.findMyMemberships(user.sub, query.cursor, query.limit);
  }

  /** Branch Staff-accessible (see TenantAuthorizationService.assertStaffAtSchool) —
   * computed signal only. `schoolId` is a required query param — see
   * MembershipsService.getMembershipStatus's own header comment for why. */
  @ApiOkResponse({ type: MembershipStatusResponseDto })
  @Get('students/:id/membership-status')
  async getMembershipStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('schoolId') schoolId: string,
  ) {
    const status = await this.membershipsService.getMembershipStatus(user.sub, id, schoolId);
    return { status };
  }
}
