import { Module } from '@nestjs/common';
import { PlatformAdminModule } from '../platform-admin/platform-admin.module';
import { TranslationsController } from './translations.controller';
import { PlatformAdminTranslationsController } from './platform-admin-translations.controller';
import { TranslationsService } from './translations.service';

/**
 * Phase 49 (ultm8-nestjs-module §5) — see `PlatformAdminModule`'s own header comment
 * for why this is a genuinely separate top-level module rather than code added
 * directly into `PlatformAdminModule`'s own registration.
 *
 * `imports: [PlatformAdminModule]` for two things `PlatformAdminTranslationsController`/
 * `TranslationsService` need, both now exported from `PlatformAdminModule` for the
 * first time:
 * - `PlatformAdminJwtAuthGuard`, for `@UseGuards()`. A guard class used this way is
 *   NOT resolved like a normal constructor-injected provider — Nest builds it a
 *   fresh, module-local instance scoped to *this* module, so the guard's own
 *   constructor dependency (`PlatformAdminAuthService`) must ALSO be exported from
 *   `PlatformAdminModule`, or Nest throws at boot trying to resolve it. Verified
 *   directly against the installed `@nestjs/core` source before relying on it — see
 *   `PlatformAdminModule`'s own `exports` line for the full account.
 * - `AuditLogService`, plain constructor-injected into `TranslationsService` — no
 *   special DI concern, same mechanism `AuthModule`'s own existing
 *   `exports: [AuthService, TwilioVerifyService]` already uses.
 */
@Module({
  imports: [PlatformAdminModule],
  controllers: [TranslationsController, PlatformAdminTranslationsController],
  providers: [TranslationsService],
})
export class TranslationsModule {}
