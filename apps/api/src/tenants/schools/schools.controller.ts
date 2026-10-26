import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { SchoolsService } from './schools.service';
import { CreateSchoolDto } from './dto/create-school.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { SchoolListResponseDto, SchoolResponseDto, SchoolThemeResponseDto } from './dto/school-response.dto';
import { JoinSchoolResponseDto } from './dto/join-school-response.dto';
import { JoinSchoolDto } from './dto/join-school.dto';
import { JoinFranchiseDto } from './dto/join-franchise.dto';
import { StudentListResponseDto } from './dto/student-summary-response.dto';
import { StudentRosterQueryDto } from './dto/student-roster-query.dto';
import { SetHomeBranchDto, StudentHomeBranchResponseDto } from './dto/home-branch.dto';
import { UpdateStudentProfileDto } from './dto/update-student-profile.dto';
import { UserResponseDto } from '../../users/dto/user-response.dto';

// Create / read / update only — no delete endpoint (general tenant offboarding is
// [UNRESOLVED], ultm8-app-publishing §4 — not ultm8-domain-rules §2, which is about
// Franchise/School/Branch organisational structure, not offboarding; corrected here
// after this same miscitation was found copied across four files).
@ApiTags('schools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools')
export class SchoolsController {
  constructor(private readonly schoolsService: SchoolsService) {}

  @ApiCreatedResponse({ type: SchoolResponseDto })
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateSchoolDto) {
    return this.schoolsService.create(user.sub, dto);
  }

  @ApiOkResponse({ type: SchoolListResponseDto })
  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query() query: PaginationQueryDto) {
    return this.schoolsService.findAllForCaller(user.sub, query.cursor, query.limit);
  }

  @ApiOkResponse({ type: SchoolResponseDto })
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.schoolsService.findOne(user.sub, id);
  }

  /** FOUND ON REVIEW — see SchoolsService.findTheme's own header comment. */
  @ApiOkResponse({ type: SchoolThemeResponseDto })
  @Get(':id/theme')
  findTheme(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.schoolsService.findTheme(user.sub, id);
  }

  @ApiOkResponse({ type: SchoolResponseDto })
  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateSchoolDto) {
    return this.schoolsService.update(user.sub, id, dto);
  }

  /** The Student roster — Staff-only, see SchoolsService.findAllStudentsForSchool.
   * `status` (Active/Inactive/All) defaults to ACTIVE when omitted — the exact
   * pre-existing behavior (StudentRosterQueryDto). */
  @ApiOkResponse({ type: StudentListResponseDto })
  @Get(':id/students')
  findStudents(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Query() query: StudentRosterQueryDto) {
    return this.schoolsService.findAllStudentsForSchool(user.sub, id, query.status, query.search);
  }

  /** School Owner/Manager only — assign or change a student's home branch
   * (Decisions 148, 168). */
  @ApiOkResponse({ type: StudentHomeBranchResponseDto })
  @Put(':id/students/:studentId/home-branch')
  setStudentHomeBranch(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: SetHomeBranchDto,
  ) {
    return this.schoolsService.setStudentHomeBranch(user.sub, id, studentId, dto);
  }

  /** Staff (School Owner/Manager, Branch Staff, or Instructor) editing a Student's
   * own profile on their behalf — see SchoolsService.updateStudentProfile's own
   * header comment for the full authorization/field-scope account. */
  @ApiOkResponse({ type: UserResponseDto })
  @Patch(':id/students/:studentId/profile')
  updateStudentProfile(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: UpdateStudentProfileDto,
  ) {
    return this.schoolsService.updateStudentProfile(user.sub, id, studentId, dto);
  }

  @ApiCreatedResponse({ type: JoinSchoolResponseDto })
  @Post(':id/join')
  join(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: JoinSchoolDto) {
    return this.schoolsService.join(user.sub, id, dto);
  }

  /** School Owner/Manager only — see SchoolsService.joinFranchise's own header
   * comment for the full "narrow, one-way only" account (Phase 16b-i, Decision 98). */
  @ApiCreatedResponse({ type: SchoolResponseDto })
  @Post(':id/join-franchise')
  joinFranchise(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: JoinFranchiseDto) {
    return this.schoolsService.joinFranchise(user.sub, id, dto.franchiseId);
  }

  /** School Owner/Manager only — see SchoolsService.leaveFranchise's own header
   * comment for the full account (Decision 232). "Switch Franchise" is this
   * endpoint followed by an ordinary POST :id/join-franchise call, not a
   * separate combined one. */
  @ApiOkResponse({ type: SchoolResponseDto })
  @Post(':id/leave-franchise')
  leaveFranchise(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.schoolsService.leaveFranchise(user.sub, id);
  }

  /** School Owner/Manager only — see SchoolsService.regenerateJoinCode's own
   * header comment (Decision 266). */
  @ApiOkResponse({ type: SchoolResponseDto })
  @Post(':id/join-code/regenerate')
  regenerateJoinCode(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.schoolsService.regenerateJoinCode(user.sub, id);
  }
}
