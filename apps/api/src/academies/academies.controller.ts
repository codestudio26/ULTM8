import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { AcademiesService } from './academies.service';
import { AcademyDetailDto, AcademyListResponseDto, AcademyTimetableListResponseDto } from './dto/academy-response.dto';

/**
 * Phase 14 scope only: read-only mobile-facing discovery (`GET /academies`,
 * `/academies/:id`, `/academies/:id/timetable`). See AcademiesService's own
 * header comment for the RLS/role mechanism this relies on (Decision 94) and the
 * Phase 14 kickoff prompt for what's deliberately not built.
 *
 * Standard `JwtAuthGuard` — same as every other module. "Mobile-facing
 * discovery" could plausibly mean a genuinely public, pre-signup browsing
 * experience, but nothing in the confirmed scope says "public," and an
 * unauthenticated endpoint would be a first-ever architectural departure for
 * this API — resolved to the conservative, authenticated reading, flagged for
 * Architect confirmation rather than assumed (Phase 14 kickoff prompt §3). No
 * `@CurrentUser()` extraction below — unlike every other module, AcademiesService
 * doesn't need the caller's own id (it authorizes via JwtAuthGuard alone, not a
 * per-caller tenant context); see AcademiesService's own header comment.
 */
@ApiTags('academies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('academies')
export class AcademiesController {
  constructor(private readonly academiesService: AcademiesService) {}

  @ApiOkResponse({ type: AcademyListResponseDto })
  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.academiesService.findAll(query.cursor, query.limit);
  }

  @ApiOkResponse({ type: AcademyDetailDto })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.academiesService.findOne(id);
  }

  @ApiOkResponse({ type: AcademyTimetableListResponseDto })
  @Get(':id/timetable')
  findTimetable(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.academiesService.findTimetable(id, query.cursor, query.limit);
  }
}
