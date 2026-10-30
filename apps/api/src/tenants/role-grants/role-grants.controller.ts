import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { jwtSubTracker } from '../../common/throttle/identity-trackers';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { RoleGrantsService } from './role-grants.service';
import { CreateRoleGrantDto } from './dto/create-role-grant.dto';
import { CreatedRoleGrantResponseDto, RoleGrantListResponseDto, RoleGrantResponseDto } from './dto/role-grant-response.dto';
import { LookupInviteCandidateQueryDto } from './dto/lookup-invite-candidate-query.dto';
import { InviteCandidateResponseDto } from './dto/invite-candidate-response.dto';
import { CreateStaffManuallyDto } from './dto/create-staff-manually.dto';
import { CreateStaffManuallyResponseDto } from './dto/create-staff-manually-response.dto';
import { CreateStudentManuallyDto } from './dto/create-student-manually.dto';
import { CreateStudentManuallyResponseDto } from './dto/create-student-manually-response.dto';
import {
  HandOverMainOwnerDto,
  MainOwnerResponseDto,
  MyStaffAccessResponseDto,
  PauseStaffResponseDto,
  StaffAccessDto,
  StaffAccessResponseDto,
  StaffDetailsResponseDto,
  StaffListQueryDto,
  StaffListResponseDto,
  StaffActivityQueryDto,
  StaffActivityResponseDto,
  StaffSettingsDto,
  StaffSettingsResponseDto,
  UnpauseStaffResponseDto,
  UpdateStaffDetailsDto,
} from './dto/staff-list.dto';

/** Each Add Manually call sends an email — limited per account, same tier as
 * InstructorsController's own add-manually throttle (ADD_MANUALLY_THROTTLE). */
const ADD_MANUALLY_THROTTLE = { identity: { limit: 20, ttl: 3_600_000, getTracker: jwtSubTracker } };

// Per ultm8-nestjs-module §5's TenantsModule row: POST/DELETE /users/{id}/role-grants.
// GET /users/{id}/role-grants is a Developer-added minimum — DELETE needs a grant id to
// target, and there is no other way to discover one; flagged for Architect review, same
// treatment as other reasonable-minimum additions in this codebase.
//
// No class-level path prefix (Decision 116) — the three users/:userId/... routes below
// keep their full paths explicit so schools/:schoolId/role-grants/invite-candidate can
// live in this same controller; mechanical change only, no behavior change to those three.
@ApiTags('role-grants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class RoleGrantsController {
  constructor(private readonly roleGrantsService: RoleGrantsService) {}

  @ApiCreatedResponse({ type: CreatedRoleGrantResponseDto })
  @Post('users/:userId/role-grants')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('userId') targetUserId: string,
    @Body() dto: CreateRoleGrantDto,
  ) {
    return this.roleGrantsService.create(user.sub, targetUserId, dto);
  }

  @ApiOkResponse({ type: RoleGrantListResponseDto })
  @Get('users/:userId/role-grants')
  findAll(
    @CurrentUser() user: JwtPayload,
    @Param('userId') targetUserId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.roleGrantsService.findAllForUser(user.sub, targetUserId, query.cursor, query.limit);
  }

  @ApiOkResponse({ type: RoleGrantResponseDto })
  @Delete('users/:userId/role-grants/:roleGrantId')
  revoke(
    @CurrentUser() user: JwtPayload,
    @Param('userId') targetUserId: string,
    @Param('roleGrantId') roleGrantId: string,
  ) {
    return this.roleGrantsService.revoke(user.sub, targetUserId, roleGrantId);
  }

  /** Exact email/phone lookup ahead of an invite (Decision 116) — see
   * RoleGrantsService.lookupInviteCandidate's own header comment. */
  @ApiOkResponse({ type: InviteCandidateResponseDto })
  @Get('schools/:schoolId/role-grants/invite-candidate')
  lookupInviteCandidate(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Query() query: LookupInviteCandidateQueryDto,
  ) {
    return this.roleGrantsService.lookupInviteCandidate(user.sub, schoolId, query);
  }

  // Decision 251 — Staff "Add Manually". See RoleGrantsService.createStaffManually's
  // own header comment for the full mechanism; mirrors
  // InstructorsController's add-manually route exactly, including this throttle tier.
  @ApiCreatedResponse({ type: CreateStaffManuallyResponseDto })
  @Throttle(ADD_MANUALLY_THROTTLE)
  @Post('schools/:schoolId/role-grants/add-manually')
  createStaffManually(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Body() dto: CreateStaffManuallyDto,
  ) {
    return this.roleGrantsService.createStaffManually(user.sub, schoolId, dto);
  }

  // Decision 371 — Students "Add manually": an adult with no account yet. See
  // RoleGrantsService.createStudentManually. Same throttle tier as Staff's.
  @ApiCreatedResponse({ type: CreateStudentManuallyResponseDto })
  @Throttle(ADD_MANUALLY_THROTTLE)
  @Post('schools/:schoolId/students/add-manually')
  createStudentManually(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Body() dto: CreateStudentManuallyDto,
  ) {
    return this.roleGrantsService.createStudentManually(user.sub, schoolId, dto);
  }

  /** Decision 361 — the Staff page's list. See RoleGrantsService.listStaff.
   * Branch Staff with "See the staff list" get a read-only view of their
   * branches (Decision 387). */
  @ApiOkResponse({ type: StaffListResponseDto })
  @Get('schools/:schoolId/staff')
  listStaff(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Query() query: StaffListQueryDto) {
    return this.roleGrantsService.listStaff(user.sub, schoolId, query);
  }

  /** Decision 381 — the School's own display name and work phone for a staff
   * member. See RoleGrantsService.updateStaffDetails. */
  @ApiOkResponse({ type: StaffDetailsResponseDto })
  @Patch('schools/:schoolId/staff/:userId/details')
  updateStaffDetails(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateStaffDetailsDto,
  ) {
    return this.roleGrantsService.updateStaffDetails(user.sub, schoolId, userId, dto);
  }

  /** Decision 387 — what the caller may do at this School. Declared before
   * the :userId routes. See RoleGrantsService.myStaffAccess. */
  @ApiOkResponse({ type: MyStaffAccessResponseDto })
  @Get('schools/:schoolId/staff/me/access')
  myStaffAccess(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string) {
    return this.roleGrantsService.myStaffAccess(user.sub, schoolId);
  }

  /** Decision 387 — the owner sets a Branch Staff member's access switches.
   * See RoleGrantsService.setStaffAccess. */
  @ApiOkResponse({ type: StaffAccessResponseDto })
  @Put('schools/:schoolId/staff/:userId/access')
  setStaffAccess(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Param('userId') userId: string,
    @Body() dto: StaffAccessDto,
  ) {
    return this.roleGrantsService.setStaffAccess(user.sub, schoolId, userId, dto);
  }

  /** Decision 408 — the Staff page's activity log. Owners only. */
  @ApiOkResponse({ type: StaffActivityResponseDto })
  @Get('schools/:schoolId/staff/activity')
  listStaffActivity(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Query() query: StaffActivityQueryDto) {
    return this.roleGrantsService.listStaffActivity(user.sub, schoolId, query);
  }

  /** Decision 396 — "New staff must accept first". Owner only. */
  @ApiOkResponse({ type: StaffSettingsResponseDto })
  @Get('schools/:schoolId/staff/settings')
  getStaffSettings(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string) {
    return this.roleGrantsService.getStaffSettings(user.sub, schoolId);
  }

  @ApiOkResponse({ type: StaffSettingsResponseDto })
  @Put('schools/:schoolId/staff/settings')
  setStaffSettings(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Body() dto: StaffSettingsDto) {
    return this.roleGrantsService.setStaffSettings(user.sub, schoolId, dto.mustAcceptFirst);
  }

  /** Decision 390 — the owner pauses a coach or Branch Staff member: all
   * their staff access here stops until they are unpaused. */
  @ApiCreatedResponse({ type: PauseStaffResponseDto })
  @Post('schools/:schoolId/staff/:userId/pause')
  pauseStaff(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Param('userId') userId: string) {
    return this.roleGrantsService.pauseStaff(user.sub, schoolId, userId);
  }

  /** Decision 390 — gives a paused person their roles back. */
  @ApiCreatedResponse({ type: UnpauseStaffResponseDto })
  @Post('schools/:schoolId/staff/:userId/unpause')
  unpauseStaff(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Param('userId') userId: string) {
    return this.roleGrantsService.unpauseStaff(user.sub, schoolId, userId);
  }

  // "Remove from School" (POST schools/:schoolId/staff/:userId/remove) lives in
  // StaffRemovalController: it may cancel classes, which needs BookingsModule,
  // and BookingsModule already imports this module.

  /** Decision 370 — the main owner hands the main role to a co-owner. See
   * RoleGrantsService.handOverMainOwner. */
  @ApiCreatedResponse({ type: MainOwnerResponseDto })
  @ApiHeader({
    name: 'x-step-up-token',
    required: true,
    description: 'From POST /auth/step-up/verify — the main owner re-enters their passcode first.',
  })
  @Post('schools/:schoolId/main-owner')
  handOverMainOwner(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId') schoolId: string,
    @Body() dto: HandOverMainOwnerDto,
    @Headers('x-step-up-token') stepUpToken?: string,
  ) {
    return this.roleGrantsService.handOverMainOwner(user.sub, schoolId, dto.userId, stepUpToken);
  }
}
