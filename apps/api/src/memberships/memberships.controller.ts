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
import { CancelMembershipDto, GiftFriendPassDto, SellMembershipDto } from './dto/desk-membership.dto';
import { DeskPaymentOptionsDto, RecordDeskPaymentDto, RecordDeskPaymentResponseDto } from './dto/record-desk-payment.dto';
import { MembershipPlanListResponseDto, MembershipPlanResponseDto } from './dto/membership-plan-response.dto';
import {
  DeskMembershipResponseDto,
  MembershipListResponseDto,
  MembershipResponseDto,
  MembershipStatusResponseDto,
  PlanMemberListResponseDto,
  PurchaseMembershipResponseDto,
  StudentMembershipListResponseDto,
} from './dto/membership-response.dto';
import { MembershipPlanActiveCountResponseDto } from './dto/membership-plan-active-count-response.dto';
import { MembershipPlanPriceChangeListResponseDto } from './dto/membership-plan-price-change-response.dto';

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
    return this.membershipsService.getActiveMemberCount(user.sub, id);
  }

  /** Decision 348: who holds this plan now, by name. School Owner only. */
  @ApiOkResponse({ type: PlanMemberListResponseDto })
  @Get('membership-plans/:id/members')
  findPlanMembers(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.membershipsService.findPlanMembers(user.sub, id);
  }

  /** v1.2 backend backlog "Archive action" — School Owner/Manager only, same
   * gate as createPlan/updatePlan. Idempotent — see
   * MembershipsService.archivePlan's own header comment. */
  @ApiOkResponse({ type: MembershipPlanResponseDto })
  @Post('membership-plans/:id/archive')
  archivePlan(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.membershipsService.archivePlan(user.sub, id);
  }

  /** v1.2 backend backlog "Archive action" — un-archiving, same gate, reverses
   * the flag. */
  @ApiOkResponse({ type: MembershipPlanResponseDto })
  @Post('membership-plans/:id/unarchive')
  unarchivePlan(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.membershipsService.unarchivePlan(user.sub, id);
  }

  /** v1.2 backend backlog "Subscription price-change migrate-vs-grandfather
   * prompt" — the auditable decision log, newest first. School Owner/Manager
   * only, same gate as every other MembershipPlan read/write. */
  @ApiOkResponse({ type: MembershipPlanPriceChangeListResponseDto })
  @Get('membership-plans/:id/price-changes')
  async findPriceChanges(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const items = await this.membershipsService.findPriceChanges(user.sub, id);
    return { items };
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

  /** Decision 348: cancel a Subscription at the end of its paid period. The
   * Student, a Guardian of a linked minor, or the School's owner. */
  @ApiOkResponse({ type: MembershipResponseDto })
  @Post('memberships/:id/cancel')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: CancelMembershipDto) {
    return this.membershipsService.cancelSubscriptionAtPeriodEnd(user.sub, id, dto?.studentId);
  }

  /** Decision 348: a Student's Memberships at the School. School Owner only. */
  @ApiOkResponse({ type: StudentMembershipListResponseDto })
  @Get('schools/:schoolId/students/:studentId/memberships')
  findStudentMemberships(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Param('studentId') studentId: string) {
    return this.membershipsService.findStudentMemberships(user.sub, schoolId, studentId);
  }

  /** Decision 348: the owner records a plan sold at the desk, paid in cash or
   * by bank transfer. */
  @ApiCreatedResponse({ type: DeskMembershipResponseDto })
  @Post('schools/:schoolId/students/:studentId/memberships/sell')
  sellAtDesk(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Param('studentId') studentId: string,
    @Body() dto: SellMembershipDto,
  ) {
    return this.membershipsService.sellAtDesk(user.sub, schoolId, studentId, dto);
  }

  /** Decision 348: the owner gives a Student a Friend Pass for one guest. */
  @ApiCreatedResponse({ type: DeskMembershipResponseDto })
  @Post('schools/:schoolId/students/:studentId/memberships/gift')
  giftFriendPass(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Param('studentId') studentId: string,
    @Body() dto: GiftFriendPassDto,
  ) {
    return this.membershipsService.giftFriendPass(user.sub, schoolId, studentId, dto);
  }

  /** A cash or bank payment taken at the front desk (Decision 346, G7):
   * records it and starts the Student's membership at once. */
  @ApiCreatedResponse({ type: RecordDeskPaymentResponseDto })
  @Post('schools/:schoolId/desk-payments')
  recordDeskPayment(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Body() dto: RecordDeskPaymentDto) {
    return this.membershipsService.recordDeskPayment(user.sub, schoolId, dto);
  }

  /** The students and plans the caller may record a desk payment for
   * (Decision 347): every current Student for the owner, their own branches'
   * for Branch Staff; plans that can be paid once in cash. */
  @ApiOkResponse({ type: DeskPaymentOptionsDto })
  @Get('schools/:schoolId/desk-payments/options')
  deskPaymentOptions(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string) {
    return this.membershipsService.deskPaymentOptions(user.sub, schoolId);
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
