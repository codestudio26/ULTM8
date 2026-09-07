import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { TimetableService } from './timetable.service';
import { CreateTimetableSlotDto } from './dto/create-timetable-slot.dto';
import { UpdateTimetableSlotDto } from './dto/update-timetable-slot.dto';
import { TimetableSlotListResponseDto, TimetableSlotResponseDto } from './dto/timetable-slot-response.dto';

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
    @Query() query: PaginationQueryDto,
  ) {
    return this.timetableService.findAllForSchool(user.sub, schoolId, query.cursor, query.limit);
  }

  @ApiOkResponse({ type: TimetableSlotResponseDto })
  @Get('timetable/:id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.timetableService.findOne(user.sub, id);
  }

  @ApiOkResponse({ type: TimetableSlotResponseDto })
  @Patch('timetable/:id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateTimetableSlotDto) {
    return this.timetableService.update(user.sub, id, dto);
  }
}
