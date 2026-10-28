import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { TimetableService } from './timetable.service';
import { CreateTimetableSlotDto } from './dto/create-timetable-slot.dto';
import { UpdateTimetableSlotDto } from './dto/update-timetable-slot.dto';
import { TimetableSlotListResponseDto, TimetableSlotResponseDto } from './dto/timetable-slot-response.dto';
import { TimetableOccurrenceQueryDto } from './dto/timetable-occurrence-query.dto';
import { TimetableQueryDto } from './dto/timetable-query.dto';
import { UpcomingImpactResponseDto } from './dto/upcoming-impact-response.dto';
import { TimetableCalendarQueryDto, TimetableCalendarResponseDto } from './dto/timetable-calendar.dto';
import { ClassResponseDto } from '../classes/dto/class-response.dto';
import { ClosureCreatedResponseDto, ClosureListResponseDto, CreateClosureDto } from './dto/closure.dto';

// TimetableSlot CRUD only — no delete, same reasoning as School/Branch/Class (general
// tenant offboarding is [UNRESOLVED]). The class-occurrence-generation job that
// consumes these slots lives in src/jobs/, not here.
@ApiTags('timetable')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class TimetableController {
  constructor(private readonly timetableService: TimetableService) {}

  @ApiCreatedResponse({ type: TimetableSlotResponseDto })
  @Post('schools/:schoolId/timetable')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Body() dto: CreateTimetableSlotDto,
  ) {
    return this.timetableService.create(user.sub, schoolId, dto);
  }

  @ApiOkResponse({ type: TimetableSlotListResponseDto })
  @Get('schools/:schoolId/timetable')
  findAll(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Query() query: TimetableQueryDto,
  ) {
    return this.timetableService.findAllForSchool(user.sub, schoolId, query.cursor, query.limit, query.includeArchived);
  }

  /** Decision 353 (T7, Q4) — the real Classes on the dates shown, for any School staff. */
  @ApiOkResponse({ type: TimetableCalendarResponseDto })
  @Get('schools/:schoolId/timetable/calendar')
  calendar(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Query() query: TimetableCalendarQueryDto,
  ) {
    return this.timetableService.calendar(user.sub, schoolId, query);
  }

  /** Decision 353 (Q8, Decision 319 §3) — closure dates. Any School staff read; the owner adds and removes. */
  @ApiOkResponse({ type: ClosureListResponseDto })
  @Get('schools/:schoolId/closures')
  listClosures(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string) {
    return this.timetableService.listClosures(user.sub, schoolId);
  }

  @ApiCreatedResponse({ type: ClosureCreatedResponseDto })
  @Post('schools/:schoolId/closures')
  createClosure(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Body() dto: CreateClosureDto) {
    return this.timetableService.createClosure(user.sub, schoolId, dto);
  }

  @ApiNoContentResponse()
  @HttpCode(204)
  @Delete('closures/:id')
  deleteClosure(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.timetableService.deleteClosure(user.sub, id);
  }

  @ApiOkResponse({ type: TimetableSlotResponseDto })
  @Get('timetable/:id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.timetableService.findOne(user.sub, id);
  }

  /** Decision 322 — School Owner/Manager only: upcoming Classes from this slot,
   * and how many have bookings, before a change that moves them. */
  @ApiOkResponse({ type: UpcomingImpactResponseDto })
  @Get('timetable/:id/upcoming-impact')
  getUpcomingImpact(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.timetableService.getUpcomingImpact(user.sub, id);
  }

  @ApiOkResponse({ type: TimetableSlotResponseDto })
  @Patch('timetable/:id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateTimetableSlotDto) {
    return this.timetableService.update(user.sub, id, dto);
  }

  /** Decision 226 — School Owner/Manager only, idempotent, blocked (409) by
   * an upcoming Booking against a generated Class. */
  @ApiOkResponse({ type: TimetableSlotResponseDto })
  @Post('timetable/:id/archive')
  archive(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.timetableService.archive(user.sub, id);
  }

  @ApiOkResponse({ type: TimetableSlotResponseDto })
  @Post('timetable/:id/unarchive')
  unarchive(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.timetableService.unarchive(user.sub, id);
  }

  /** Timetable page redesign (click-to-book) — see TimetableService.findOccurrence's
   * own header comment for the full gate/404 rationale. Staff-only, unlike the plain
   * findOne above. */
  @ApiOkResponse({ type: ClassResponseDto })
  @Get('timetable/:id/occurrence')
  findOccurrence(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query() query: TimetableOccurrenceQueryDto,
  ) {
    return this.timetableService.findOccurrence(user.sub, id, query.date);
  }
}
