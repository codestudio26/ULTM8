import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PlatformAdminJwtAuthGuard } from '../platform-admin/guards/platform-admin-jwt-auth.guard';
import { CurrentAdminUser } from '../platform-admin/decorators/current-admin-user.decorator';
import { AdminJwtPayload } from '../platform-admin/interfaces/admin-jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { SubscriptionPlansService } from './subscription-plans.service';
import { CreateSubscriptionPlanDto } from './dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from './dto/update-subscription-plan.dto';
import { SubscriptionPlanListResponseDto, SubscriptionPlanResponseDto } from './dto/subscription-plan-response.dto';

/**
 * Phase 54 (create/update) + Phase 55 (list) — the Platform-Admin-authoring half of
 * SubscriptionPlansModule: `platform-admin/subscription-plans`, not
 * `/admin/subscription-plans` — same real, already-shipped `platform-admin/*`
 * convention every existing `PlatformAdminXxxController` uses (see
 * PlatformAdminTranslationsController's own header comment for the full account of
 * why this beats the skill table's own `/admin/*` wording).
 *
 * No `DELETE` route — see SubscriptionPlan's own schema.prisma comment for why this
 * phase builds no delete path (an already-subscribed Franchise/School has no
 * confirmed, safe orphaning behavior to fall back to).
 *
 * `findAll` deliberately does NOT call `assertFullAdmin` the way create/update do —
 * unlike those two, it's a plain read of non-sensitive data (see
 * SubscriptionPlanResponseDto's own header comment: "nothing here is sensitive"),
 * so `PlatformAdminJwtAuthGuard` alone (any authenticated admin, any subRole) is the
 * right bar, same as every other read-only endpoint in this codebase that has no
 * narrower confirmed sub-role to gate on. Added in Phase 55 because, unlike
 * TranslationsModule (whose `GET /translations` is deliberately public and reusable
 * from the admin authoring UI — see that controller's own comment), `GET /plans` is
 * tenant-JWT-gated (SubscriptionPlansController's own comment explains why), so a
 * Platform Admin caller has no tenant token to call it with — this app-package's own
 * `apps/platform-admin` authoring screen needs a route it actually holds a token for.
 */
@ApiTags('platform-admin-subscription-plans')
@ApiBearerAuth()
@UseGuards(PlatformAdminJwtAuthGuard)
@Controller('platform-admin/subscription-plans')
export class PlatformAdminSubscriptionPlansController {
  constructor(private readonly subscriptionPlans: SubscriptionPlansService) {}

  @ApiOkResponse({ type: SubscriptionPlanListResponseDto })
  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.subscriptionPlans.findAll(query.cursor, query.limit);
  }

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
