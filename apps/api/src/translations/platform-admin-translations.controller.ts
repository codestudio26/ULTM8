import { Body, Controller, Delete, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PlatformAdminJwtAuthGuard } from '../platform-admin/guards/platform-admin-jwt-auth.guard';
import { CurrentAdminUser } from '../platform-admin/decorators/current-admin-user.decorator';
import { AdminJwtPayload } from '../platform-admin/interfaces/admin-jwt-payload.interface';
import { TranslationsService } from './translations.service';
import { CreateTranslationDto } from './dto/create-translation.dto';
import { UpdateTranslationDto } from './dto/update-translation.dto';
import { TranslationResponseDto } from './dto/translation-response.dto';

/**
 * Phase 49 — the write half of TranslationsModule: `platform-admin/translations`,
 * not `/admin/translations` — `ultm8-nestjs-module` §5's own table describes the
 * admin-facing surface as `/admin/*`, but the real, already-shipped convention every
 * existing `PlatformAdminXxxController` in this codebase actually uses is
 * `platform-admin/*` (schools, franchises, admin-users, payment-accounts,
 * impersonation-sessions) — this follows the real convention over the skill's own
 * "representative, not final" table.
 *
 * `PlatformAdminModule`'s own header comment names Translations as a deliberately
 * *separate* module that "sits behind this module's own guard chain" rather than
 * being absorbed into `PlatformAdminModule`'s own controllers/providers the way
 * Schools/Franchises/Users/PaymentAccounts/Impersonation all are — this controller
 * lives here, in `TranslationsModule`'s own folder, and reuses
 * `PlatformAdminJwtAuthGuard` by importing `PlatformAdminModule` (see
 * `translations.module.ts`'s own comment for why that module now exports the guard).
 *
 * FULL_ADMIN-only for every route (enforced in `TranslationsService`, not the guard —
 * same convention every other sub-role-gated route in this codebase already uses).
 */
@ApiTags('platform-admin-translations')
@ApiBearerAuth()
@UseGuards(PlatformAdminJwtAuthGuard)
@Controller('platform-admin/translations')
export class PlatformAdminTranslationsController {
  constructor(private readonly translations: TranslationsService) {}

  @ApiCreatedResponse({ type: TranslationResponseDto })
  @Post()
  create(@CurrentAdminUser() admin: AdminJwtPayload, @Body() dto: CreateTranslationDto) {
    return this.translations.create(admin.sub, dto);
  }

  @ApiOkResponse({ type: TranslationResponseDto })
  @Patch(':id')
  update(@CurrentAdminUser() admin: AdminJwtPayload, @Param('id') id: string, @Body() dto: UpdateTranslationDto) {
    return this.translations.update(admin.sub, id, dto);
  }

  @ApiOkResponse({ type: TranslationResponseDto })
  @Delete(':id')
  delete(@CurrentAdminUser() admin: AdminJwtPayload, @Param('id') id: string) {
    return this.translations.delete(admin.sub, id);
  }
}
