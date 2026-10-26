import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { jwtSubTracker } from '../common/throttle/identity-trackers';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { InstructorsService } from './instructors.service';
import { InstructorsQueryDto } from './dto/instructors-query.dto';
import { CreateInstructorDto } from './dto/create-instructor.dto';
import { UpdateInstructorDto } from './dto/update-instructor.dto';
import { CreateInstructorManuallyDto } from './dto/create-instructor-manually.dto';
import { CompleteInstructorProfileDto } from './dto/complete-instructor-profile.dto';
import { RequestCertificationUploadUrlDto } from './dto/request-certification-upload-url.dto';
import { InstructorListResponseDto, InstructorResponseDto } from './dto/instructor-response.dto';
import { CreateInstructorManuallyResponseDto } from './dto/create-instructor-manually-response.dto';
import { CertificationUploadUrlResponseDto } from './dto/certification-upload-url-response.dto';
import { EligibleInstructorListResponseDto } from './dto/eligible-instructor-response.dto';
import { InstructorClassListResponseDto } from './dto/instructor-class-response.dto';
import { CertificationUrlResponseDto } from './dto/certification-url-response.dto';
import { ReassignInstructorDto, ReassignInstructorResponseDto } from './dto/reassign-instructor.dto';

/** Each Add Manually call sends an email — limited per account, same tier as
 * CoachInvitesController's own invite-send throttle. */
const ADD_MANUALLY_THROTTLE = { identity: { limit: 20, ttl: 3_600_000, getTracker: jwtSubTracker } };

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
    @Query() query: InstructorsQueryDto,
  ) {
    return this.instructorsService.findAllForSchool(user.sub, schoolId, query.cursor, query.limit, query.includeArchived, query.search);
  }

  /** Candidate pool for InstructorFormModal's picker (Decision 115). */
  @ApiOkResponse({ type: EligibleInstructorListResponseDto })
  @Get('schools/:schoolId/instructors/eligible-users')
  findEligibleUsers(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string) {
    return this.instructorsService.findEligibleInstructorUsers(user.sub, schoolId);
  }

  /** Decision 312 — declared before `instructors/:id` so `me` is never read as an id. */
  @ApiOkResponse({ type: InstructorListResponseDto })
  @Get('instructors/me/profile')
  findMyProfiles(@CurrentUser() user: JwtPayload) {
    return this.instructorsService.findMyProfiles(user.sub);
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

  /** Decision 226 — School Owner/Manager only, idempotent, blocked (409) by
   * an upcoming Class or active TimetableSlot assignment. */
  @ApiOkResponse({ type: InstructorResponseDto })
  @Post('instructors/:id/archive')
  archive(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.instructorsService.archive(user.sub, id);
  }

  @ApiOkResponse({ type: InstructorResponseDto })
  @Post('instructors/:id/unarchive')
  unarchive(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.instructorsService.unarchive(user.sub, id);
  }

  /** Decision 312 — School Owner/Manager only; a 15-minute download link. */
  @ApiOkResponse({ type: CertificationUrlResponseDto })
  @Get('instructors/:id/certification-url')
  getCertificationUrl(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.instructorsService.getCertificationUrl(user.sub, id);
  }

  /** Decision 312 — moves upcoming Classes and active Timetable slots to
   * another instructor, all or nothing. School Owner/Manager only. */
  @ApiOkResponse({ type: ReassignInstructorResponseDto })
  @HttpCode(200)
  @Post('instructors/:id/reassign')
  reassign(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ReassignInstructorDto) {
    return this.instructorsService.reassign(user.sub, id, dto.toUserId);
  }

  /** v1.2 backend backlog — "Instructor Class" grid, the real replacement for
   * the School Portal's client-side filter-the-School's-Classes workaround.
   * See InstructorsService.findClassesForInstructor's own header comment. */
  @ApiOkResponse({ type: InstructorClassListResponseDto })
  @Get('instructors/:id/classes')
  findClasses(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.instructorsService.findClassesForInstructor(user.sub, id, query.cursor, query.limit);
  }

  // Decision 1/230/237 — Instructor "Add Manually". See InstructorsService's
  // own method comments for the full mechanism.

  @ApiCreatedResponse({ type: CreateInstructorManuallyResponseDto })
  @Throttle(ADD_MANUALLY_THROTTLE)
  @Post('schools/:schoolId/instructors/add-manually')
  createManually(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Body() dto: CreateInstructorManuallyDto,
  ) {
    return this.instructorsService.createManually(user.sub, schoolId, dto);
  }

  @ApiOkResponse({ type: InstructorListResponseDto })
  @Patch('instructors/me/profile')
  completeMyProfile(@CurrentUser() user: JwtPayload, @Body() dto: CompleteInstructorProfileDto) {
    return this.instructorsService.completeMyProfile(user.sub, dto);
  }

  @ApiCreatedResponse({ type: CertificationUploadUrlResponseDto })
  @Post('instructors/me/certification-upload-url')
  requestCertificationUploadUrl(@CurrentUser() user: JwtPayload, @Body() dto: RequestCertificationUploadUrlDto) {
    return this.instructorsService.requestCertificationUploadUrl(user.sub, dto);
  }
}
