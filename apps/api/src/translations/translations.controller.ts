import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TranslationsService } from './translations.service';
import { TranslationsQueryDto } from './dto/translations-query.dto';
import { TranslationListResponseDto } from './dto/translation-response.dto';

/**
 * Phase 49 — GET /translations only (ultm8-nestjs-module §5's own confirmed
 * `GET /translations?locale=&screen=`). Deliberately NO `@UseGuards(JwtAuthGuard)` —
 * same reasoning `SettingsController`'s own header comment already gives for
 * `/settings/languages`/`/legal/:doc`: a pre-login screen (Login, Register, OTP
 * verify) needs translated copy before its caller has any token at all, so gating
 * this behind authentication would be self-defeating for its own stated purpose.
 * Spec 55 never explicitly states this route is public, but — same as Settings —
 * it's also not named among the admin-namespaced modules it does explicitly list.
 */
@ApiTags('translations')
@Controller()
export class TranslationsController {
  constructor(private readonly translations: TranslationsService) {}

  @ApiOkResponse({ type: TranslationListResponseDto })
  @Get('translations')
  findAll(@Query() query: TranslationsQueryDto) {
    return this.translations.findAll(query.screen, query.locale, query.cursor, query.limit);
  }
}
