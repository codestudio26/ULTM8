import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Phase 7 scope only: GET /settings/languages, GET /settings/currencies,
 * GET /legal/:doc — see the Phase 7 kickoff prompt for the full rationale on why
 * this replaced the roadmap's original Phase 7 pick (SubscriptionPlansModule, whose
 * authoring surface needs Platform Admin auth that doesn't exist yet).
 *
 * No cross-module imports needed — `PrismaAppService` is global (from
 * `PrismaModule`), same as `UsersModule`'s own no-extra-imports shape in Phase 6.
 */
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
