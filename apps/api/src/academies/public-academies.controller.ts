import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AcademiesService } from './academies.service';
import { AcademyDetailDto, AcademyListResponseDto } from './dto/academy-response.dto';
import { JoinCodeParamDto } from './dto/join-code-param.dto';
import { SchoolSearchQueryDto } from './dto/school-search-query.dto';

// Decision 266 (Apple 4.2.6/4.3 compliance, Decision 247) — the one deliberately
// PUBLIC, unauthenticated surface in this API. A brand-new apps/student installer
// has no account yet when they pick their School, so the existing AcademiesController
// (JwtAuthGuard, Phase 14) can't serve this — this is a NEW, separate controller
// rather than relaxing that guard, so the Phase 14 "conservative, authenticated
// reading" for the general discovery browse (/academies) stays exactly as it was
// confirmed; only these two narrow, purpose-built routes are public.
//
// Both routes go through AcademiesService's existing `ultm8_discovery`-backed
// methods (search()/findByJoinCode()) — same column-level curation, same Postgres
// GRANTs (Decision 94) as the authenticated discovery endpoints. No new DB role.
//
// Explicit IP-only throttles, tighter than the app-wide generous default
// (app.module.ts's ipLimitPerMinute(), 60/min) — this is the first genuinely
// unauthenticated surface in the API, so a stricter purpose-specific limit is
// warranted even though the join code's own entropy (32^8) already makes brute
// force impractical (defense in depth, not the primary control).
const SCHOOL_SEARCH_THROTTLE = { default: { limit: 30, ttl: 60_000 } };
const SCHOOL_JOIN_CODE_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('public-schools')
@Controller('public/schools')
export class PublicAcademiesController {
  constructor(private readonly academiesService: AcademiesService) {}

  @Throttle(SCHOOL_SEARCH_THROTTLE)
  @ApiOkResponse({ type: AcademyListResponseDto })
  @Get('search')
  search(@Query() query: SchoolSearchQueryDto) {
    return this.academiesService.search(query.q, query.cursor, query.limit);
  }

  @Throttle(SCHOOL_JOIN_CODE_THROTTLE)
  @ApiOkResponse({ type: AcademyDetailDto })
  @Get('by-code/:code')
  findByJoinCode(@Param() params: JoinCodeParamDto) {
    return this.academiesService.findByJoinCode(params.code.toUpperCase());
  }
}
