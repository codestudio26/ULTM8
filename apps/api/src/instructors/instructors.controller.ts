import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { InstructorsService } from './instructors.service';
import { CreateInstructorDto } from './dto/create-instructor.dto';
import { UpdateInstructorDto } from './dto/update-instructor.dto';
import { InstructorListResponseDto, InstructorResponseDto } from './dto/instructor-response.dto';
import { EligibleInstructorListResponseDto } from './dto/eligible-instructor-response.dto';

// Instructor profile CRUD only this phase — attendance-scan and booking-override wait
// for Booking to exist and Decision 71's still-open engineering design pass. See the
// Phase 6 kickoff prompt for the full scoping rationale. No delete endpoint, same
// reasoning as School/Branch/Class/TimetableSlot (general tenant offboarding is
// [UNRESOLVED]).
@ApiTags('instructors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class InstructorsController {
  constructor(private readonly instructorsService: InstructorsService) {}

  @ApiCreatedResponse({ type: InstructorResponseDto })
  @Post('schools/:schoolId/instructors')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Body() dto: CreateInstructorDto,
  ) {
    return this.instructorsService.create(user.sub, schoolId, dto);
  }

  @ApiOkResponse({ type: InstructorListResponseDto })
  @Get('schools/:schoolId/instructors')
  findAll(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.instructorsService.findAllForSchool(user.sub, schoolId, query.cursor, query.limit);
  }

  /** Candidate pool for InstructorFormModal's picker (Decision 114). */
  @ApiOkResponse({ type: EligibleInstructorListResponseDto })
  @Get('schools/:schoolId/instructors/eligible-users')
  findEligibleUsers(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string) {
    return this.instructorsService.findEligibleInstructorUsers(user.sub, schoolId);
  }

  @ApiOkResponse({ type: InstructorResponseDto })
  @Get('instructors/:id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.instructorsService.findOne(user.sub, id);
  }

  @ApiOkResponse({ type: InstructorResponseDto })
  @Patch('instructors/:id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateInstructorDto) {
    return this.instructorsService.update(user.sub, id, dto);
  }
}
