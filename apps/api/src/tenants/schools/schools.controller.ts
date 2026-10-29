import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { SchoolsService, withoutBillingIds } from './schools.service';
import { FranchisePreviewQueryDto, FranchisePreviewResponseDto } from './dto/franchise-preview.dto';
import { CreateSchoolDto } from './dto/create-school.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { SchoolFranchiseBrandingResponseDto, SchoolListResponseDto, SchoolResponseDto, SchoolThemeResponseDto } from './dto/school-response.dto';
import { JoinSchoolResponseDto } from './dto/join-school-response.dto';
import { JoinSchoolDto } from './dto/join-school.dto';
import { JoinFranchiseDto } from './dto/join-franchise.dto';
import { CloseOwnSchoolDto, CloseOwnSchoolResponseDto } from './dto/close-own-school.dto';
import { FranchiseJoinRequestResponseDto, SchoolFranchiseJoinRequestResponseDto } from '../franchises/dto/franchise-join-request.dto';
import { StudentListResponseDto } from './dto/student-summary-response.dto';
import { StudentRosterQueryDto } from './dto/student-roster-query.dto';
import { StudentExportQueryDto, StudentExportResponseDto } from './dto/student-export.dto';
import { StudentExportService } from './student-export.service';
import { SetHomeBranchDto, StudentHomeBranchResponseDto } from './dto/home-branch.dto';
import { UpdateStudentProfileDto } from './dto/update-student-profile.dto';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { StudentLeavingSummaryResponseDto } from './dto/student-leaving-summary-response.dto';
import { StudentGuardiansResponseDto } from './dto/student-guardians-response.dto';

// Create / read / update only — no delete endpoint (general tenant offboarding is
// [UNRESOLVED], ultm8-app-publishing §4 — not ultm8-domain-rules §2, which is about
// Franchise/School/Branch organisational structure, not offboarding; corrected here
// after this same miscitation was found copied across four files).
@ApiTags('schools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools')
export class SchoolsController {
  constructor(
    private readonly schoolsService: SchoolsService,
    private readonly studentExport: StudentExportService,
  ) {}

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
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return withoutBillingIds(await this.schoolsService.findOne(user.sub, id));
  }

  /** FOUND ON REVIEW — see SchoolsService.findTheme's own header comment. */
  @ApiOkResponse({ type: SchoolThemeResponseDto })
  @Get(':id/theme')
  findTheme(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.schoolsService.findTheme(user.sub, id);
  }

  /** Decision 350 — see SchoolsService.findFranchiseBranding. */
  @ApiOkResponse({ type: SchoolFranchiseBrandingResponseDto })
  @Get(':id/franchise-branding')
  findFranchiseBranding(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.schoolsService.findFranchiseBranding(user.sub, id);
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

  /** Backlog 3.9 (Decision 399): the student list to export, for the owner or
   * Branch Staff the owner allows. Logged. */
  @ApiOkResponse({ type: StudentExportResponseDto })
  @Get(':id/students/export')
  exportStudents(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Query() query: StudentExportQueryDto) {
    return this.studentExport.export(user.sub, id, query.filter);
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

  /** The Student's full profile, for the staff edit form (Decision 341) — same
   * access as the PATCH below. */
  @ApiOkResponse({ type: UserResponseDto })
  @Get(':id/students/:studentId/profile')
  getStudentProfile(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.schoolsService.getStudentProfile(user.sub, id, studentId);
  }

  /** The student's Guardians, by name, for the student's page (Decision 371).
   * Same staff who can read the student's profile. */
  @ApiOkResponse({ type: StudentGuardiansResponseDto })
  @Get(':id/students/:studentId/guardians')
  getStudentGuardians(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.schoolsService.getStudentGuardians(user.sub, id, studentId);
  }

  /** What revoking this Student's enrolment will cancel, and the memberships
   * it leaves running — for the owner's Revoke dialog (Decision 343). */
  @ApiOkResponse({ type: StudentLeavingSummaryResponseDto })
  @Get(':id/students/:studentId/leaving-summary')
  getStudentLeavingSummary(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return this.schoolsService.getStudentLeavingSummary(user.sub, id, studentId);
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

  /** School Owner/Manager only — asks the Franchise Owner to let this School
   * join (Decision 352); see SchoolsService.joinFranchise. */
  @ApiCreatedResponse({ type: FranchiseJoinRequestResponseDto })
  @Post(':id/join-franchise')
  joinFranchise(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: JoinFranchiseDto) {
    return this.schoolsService.joinFranchise(user.sub, id, dto.franchiseId);
  }

  /** Decision 368 — the Franchise's name, so the School Owner can check it
   * before asking to join; see SchoolsService.previewFranchise. */
  @ApiOkResponse({ type: FranchisePreviewResponseDto })
  @Get(':id/franchise-preview')
  previewFranchise(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Query() query: FranchisePreviewQueryDto) {
    return this.schoolsService.previewFranchise(user.sub, id, query.franchiseId);
  }

  /** Decision 352 — the School's latest request to join a Franchise. */
  @ApiOkResponse({ type: SchoolFranchiseJoinRequestResponseDto })
  @Get(':id/franchise-join-request')
  findFranchiseJoinRequest(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.schoolsService.findFranchiseJoinRequest(user.sub, id);
  }

  /** Decision 352 — withdraw the open request. */
  @ApiOkResponse({ type: FranchiseJoinRequestResponseDto })
  @HttpCode(200)
  @Post(':id/franchise-join-request/cancel')
  cancelFranchiseJoinRequest(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.schoolsService.cancelFranchiseJoinRequest(user.sub, id);
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

  /** Decision 364 — the School Owner closes their own School, with its name
   * re-typed and a passcode check. Not during impersonation. */
  @ApiOkResponse({ type: CloseOwnSchoolResponseDto })
  @ApiHeader({ name: 'x-step-up-token', required: true, description: 'From POST /auth/step-up/verify (passcode check).' })
  @HttpCode(200)
  @Post(':id/close')
  closeOwnSchool(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CloseOwnSchoolDto,
    @Headers('x-step-up-token') stepUpToken?: string,
  ) {
    if (user.impersonation) {
      // Decision 39
      throw new ForbiddenException('Closing a School is not available during an impersonation session.');
    }
    return this.schoolsService.closeOwnSchool(user.sub, id, dto, stepUpToken);
  }

  /** School Owner/Manager only — see SchoolsService.regenerateJoinCode's own
   * header comment (Decision 266). */
  @ApiOkResponse({ type: SchoolResponseDto })
  @Post(':id/join-code/regenerate')
  regenerateJoinCode(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.schoolsService.regenerateJoinCode(user.sub, id);
  }
}
