import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { RoleGrantsService } from './role-grants.service';
import { CreateRoleGrantDto } from './dto/create-role-grant.dto';
import { RoleGrantListResponseDto, RoleGrantResponseDto } from './dto/role-grant-response.dto';
import { LookupInviteCandidateQueryDto } from './dto/lookup-invite-candidate-query.dto';
import { InviteCandidateResponseDto } from './dto/invite-candidate-response.dto';

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

  @ApiCreatedResponse({ type: RoleGrantResponseDto })
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
}
