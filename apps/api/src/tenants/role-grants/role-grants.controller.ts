import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
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
import { RemoveFromSchoolResponseDto, StaffListQueryDto, StaffListResponseDto } from './dto/staff-list.dto';

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

  /** Decision 361 — the Staff page's list. See RoleGrantsService.listStaff. */
  @ApiOkResponse({ type: StaffListResponseDto })
  @Get('schools/:schoolId/staff')
  listStaff(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Query() query: StaffListQueryDto) {
    return this.roleGrantsService.listStaff(user.sub, schoolId, query);
  }

  /** Decision 361 — "Remove from School". See RoleGrantsService.removeFromSchool. */
  @ApiCreatedResponse({ type: RemoveFromSchoolResponseDto })
  @Post('schools/:schoolId/staff/:userId/remove')
  removeFromSchool(@CurrentUser() user: JwtPayload, @Param('schoolId') schoolId: string, @Param('userId') userId: string) {
    return this.roleGrantsService.removeFromSchool(user.sub, schoolId, userId);
  }
}
