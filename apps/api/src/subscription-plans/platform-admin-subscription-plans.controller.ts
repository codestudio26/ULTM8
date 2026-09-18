import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PlatformAdminJwtAuthGuard } from '../platform-admin/guards/platform-admin-jwt-auth.guard';
import { CurrentAdminUser } from '../platform-admin/decorators/current-admin-user.decorator';
import { AdminJwtPayload } from '../platform-admin/interfaces/admin-jwt-payload.interface';
import { SubscriptionPlansService } from './subscription-plans.service';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';
import { SubscriptionPlanResponseDto } from './dto/subscription-plan-response.dto';

/**
 * Phase 54 — the write half of SubscriptionPlansModule: `platform-admin/
 * subscription-plans`, not `/admin/subscription-plans` — same real, already-shipped
 * `platform-admin/*` convention every existing `PlatformAdminXxxController` uses
 * (see PlatformAdminTranslationsController's own header comment for the full
 * account of why this beats the skill table's own `/admin/*` wording).
 *
 * No `DELETE` route — see SubscriptionPlan's own schema.prisma comment for why this
 * phase builds no delete path (an already-subscribed Franchise/School has no
 * confirmed, safe orphaning behavior to fall back to).
 *
 * FULL_ADMIN-only for every route (enforced in SubscriptionPlansService, not the
 * guard) — same convention every other sub-role-gated route in this codebase uses.
 */
@ApiTags('platform-admin-subscription-plans')
@ApiBearerAuth()
@UseGuards(PlatformAdminJwtAuthGuard)
@Controller('platform-admin/subscription-plans')
export class PlatformAdminSubscriptionPlansController {
  constructor(private readonly subscriptionPlans: SubscriptionPlansService) {}

  @ApiCreatedResponse({ type: SubscriptionPlanResponseDto })
  @Post()
  create(@CurrentAdminUser() admin: AdminJwtPayload, @Body() dto: CreateSubscriptionPlanDto) {
    return this.subscriptionPlans.create(admin.sub, dto);
  }

  @ApiOkResponse({ type: SubscriptionPlanResponseDto })
  @Patch(':id')
  update(@CurrentAdminUser() admin: AdminJwtPayload, @Param('id') id: string, @Body() dto: UpdateSubscriptionPlanDto) {
    return this.subscriptionPlans.update(admin.sub, id, dto);
  }
}
