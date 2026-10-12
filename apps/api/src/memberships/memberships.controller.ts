import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
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
import { MembershipPlanActiveCountResponseDto } from './dto/membership-plan-active-count-response.dto';

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

  /** v1.2 backend backlog — MembershipPlansPage's "Active members" stat tile.
   * See MembershipsService.getActiveMemberCount's own header comment. */
  @ApiOkResponse({ type: MembershipPlanActiveCountResponseDto })
  @Get('membership-plans/:id/active-count')
  async getActiveCount(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const activeCount = await this.membershipsService.getActiveMemberCount(user.sub, id);
    return { activeCount };
  }

  // Decision 236's own follow-up — required only when dto.payWithSavedCard is
  // true (MembershipsService.purchase()'s own call to StepUpService.
  // assertVerified()), same optional-at-this-layer shape
  // GuardiansController.withdrawConsent() already established for this exact
  // mechanism's first consumer.
  @ApiOkResponse({ type: PurchaseMembershipResponseDto })
  @ApiHeader({
    name: 'x-step-up-token',
    required: false,
    description: 'Required only when payWithSavedCard is true (Decision 236) — from POST /auth/step-up/verify.',
  })
  @Post('membership-plans/:id/purchase')
  purchase(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: PurchaseMembershipDto,
    @Headers('x-step-up-token') stepUpToken?: string,
  ) {
    return this.membershipsService.purchase(user.sub, id, dto, stepUpToken);
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
