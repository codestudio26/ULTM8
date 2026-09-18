import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { SubscriptionPlansService } from './subscription-plans.service';
import { SubscriptionPlanListResponseDto } from './dto/subscription-plan-response.dto';
import { SubscribeResponseDto } from './dto/subscribe-response.dto';
import { CancelSubscriptionResponseDto } from './dto/cancel-subscription-response.dto';

/**
 * Phase 54 — tenant-facing half of SubscriptionPlansModule: `GET /plans` (Spec 55
 * §7's own confirmed shape), plus subscribe/cancel under `schools/:schoolId/...` and
 * `franchises/:franchiseId/...` rather than the spec's own literal
 * `POST /plans/{id}/subscribe` single route — see SubscriptionPlansService's own
 * header comment for the full reasoning (this codebase's real, already-shipped
 * "School vs Franchise gets its own route pair" convention, same class of deviation
 * TranslationsModule's own `platform-admin/*` routing already made).
 *
 * `@UseGuards(JwtAuthGuard)` on the whole controller, including `GET /plans` — unlike
 * TranslationsController's own deliberately-public `GET /translations` (pre-login
 * screens need translated copy before any token exists), no confirmed pre-login need
 * exists for platform-plan pricing data, so this defaults to the ordinary tenant-JWT
 * gate every other list endpoint in this codebase already uses. Flagged as a
 * Developer-level call, not silently assumed — revisit if a public pricing page ever
 * becomes a confirmed requirement.
 */
@ApiTags('subscription-plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class SubscriptionPlansController {
  constructor(private readonly subscriptionPlans: SubscriptionPlansService) {}

  @ApiOkResponse({ type: SubscriptionPlanListResponseDto })
  @Get('plans')
  findAll(@Query() query: PaginationQueryDto) {
    return this.subscriptionPlans.findAll(query.cursor, query.limit);
  }

  @ApiOkResponse({ type: SubscribeResponseDto })
  @Post('schools/:schoolId/subscription-plans/:planId/subscribe')
  subscribeSchool(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Param('planId') planId: string) {
    return this.subscriptionPlans.subscribeSchool(user.sub, schoolId, planId);
  }

  @ApiOkResponse({ type: SubscribeResponseDto })
  @Post('franchises/:franchiseId/subscription-plans/:planId/subscribe')
  subscribeFranchise(@CurrentUser() user: JwtPayload, @Param('franchiseId') franchiseId: string, @Param('planId') planId: string) {
    return this.subscriptionPlans.subscribeFranchise(user.sub, franchiseId, planId);
  }

  @ApiOkResponse({ type: CancelSubscriptionResponseDto })
  @Post('schools/:schoolId/subscription/cancel')
  cancelSchoolSubscription(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string) {
    return this.subscriptionPlans.cancelSchoolSubscription(user.sub, schoolId);
  }

  @ApiOkResponse({ type: CancelSubscriptionResponseDto })
  @Post('franchises/:franchiseId/subscription/cancel')
  cancelFranchiseSubscription(@CurrentUser() user: JwtPayload, @Param('franchiseId') franchiseId: string) {
    return this.subscriptionPlans.cancelFranchiseSubscription(user.sub, franchiseId);
  }
}
