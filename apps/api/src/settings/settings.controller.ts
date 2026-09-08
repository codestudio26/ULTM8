import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { CodeNameResponseDto } from './dto/code-name-response.dto';
import { LegalDocumentResponseDto } from './dto/legal-document-response.dto';

// Three GET endpoints only this phase (settings/languages, settings/currencies,
// legal/:doc) — see the Phase 7 kickoff prompt for the full scoping rationale.
// "permissions metadata", named in Spec 55's own SettingsModule description but
// with no corresponding confirmed endpoint, is [UNRESOLVED] and not built here.
//
// Deliberately NO @UseGuards(JwtAuthGuard) anywhere in this controller — inferred
// choice, flagged for Architect review: a prospective registrant needs to read the
// Terms & Conditions and pick a language/currency before they have an account or a
// token, so gating these behind authentication would be self-defeating for their
// own stated purpose. Spec 55 never explicitly states these are public, but they're
// also not named among the admin-namespaced modules it does explicitly list
// (PlatformAdminModule, MobileAppPublishingModule, SubscriptionPlansModule's admin
// surface, TranslationsModule).
//
// Single @Controller() with no class-level prefix, full path given per method —
// syntactically the same multi-prefix-in-one-controller shape ClassesController
// uses for schools/:schoolId/classes alongside classes/:id, though not a perfect
// precedent match: Classes' two prefixes are both the Class resource; legal/:doc
// here is a genuinely different resource (LegalDocument) grouped into this
// controller for this module's small size, not because it's the same resource as
// settings/*. Worth a dedicated LegalController if legal/* grows real complexity
// of its own (e.g. once Platform Admin auth lands and it needs guards settings/*
// still shouldn't have) — flagged, not restructured preemptively for a 3-route module.
@ApiTags('settings')
@Controller()
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @ApiOkResponse({ type: [CodeNameResponseDto], description: 'code is BCP-47-shaped.' })
  @Get('settings/languages')
  getLanguages() {
    return this.settingsService.getLanguages();
  }

  @ApiOkResponse({ type: [CodeNameResponseDto], description: 'code is ISO 4217.' })
  @Get('settings/currencies')
  getCurrencies() {
    return this.settingsService.getCurrencies();
  }

  @ApiOkResponse({ type: LegalDocumentResponseDto })
  @Get('legal/:doc')
  getLegalDocument(@Param('doc') doc: string) {
    return this.settingsService.getLegalDocument(doc);
  }
}
