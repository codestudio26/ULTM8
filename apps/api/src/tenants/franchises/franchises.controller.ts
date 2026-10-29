import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { FranchisesService } from './franchises.service';
import { CreateFranchiseDto } from './dto/create-franchise.dto';
import { UpdateFranchiseDto } from './dto/update-franchise.dto';
import { FranchiseListResponseDto, FranchiseMemberSchoolListResponseDto, FranchiseResponseDto } from './dto/franchise-response.dto';
import { FranchisesQueryDto } from './dto/franchises-query.dto';
import { FranchiseBillingStatusResponseDto } from './dto/franchise-billing-status-response.dto';
import { CloseOwnFranchiseDto, FranchiseJoinRequestListResponseDto, FranchiseJoinRequestResponseDto } from './dto/franchise-join-request.dto';
import { RemoveFranchiseSchoolResponseDto } from './dto/remove-franchise-school-response.dto';

// Create / read / update only — no delete endpoint, same reasoning as SchoolsController
// (general tenant offboarding is [UNRESOLVED], ultm8-app-publishing §4).
@ApiTags('franchises')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('franchises')
export class FranchisesController {
  constructor(private readonly franchisesService: FranchisesService) {}

  @ApiCreatedResponse({ type: FranchiseResponseDto })
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateFranchiseDto) {
    return this.franchisesService.create(user.sub, dto);
  }

  @ApiOkResponse({ type: FranchiseListResponseDto })
  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query() query: FranchisesQueryDto) {
    return this.franchisesService.findAllForCaller(user.sub, query.cursor, query.limit, query.feeModel, query.activity, query.search, query.excludeArchived);
  }

  @ApiOkResponse({ type: FranchiseResponseDto })
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.franchisesService.findOne(user.sub, id);
  }

  @ApiOkResponse({ type: FranchiseResponseDto })
  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateFranchiseDto) {
    return this.franchisesService.update(user.sub, id, dto);
  }

  @ApiOkResponse({ type: FranchiseBillingStatusResponseDto })
  @Get(':id/billing-status')
  getBillingStatus(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.franchisesService.getBillingStatus(user.sub, id);
  }

  /**
   * Franchise Owner's own School roster (ultm8-nestjs-module §5's confirmed
   * `GET /franchises/{id}/schools`) — see FranchisesService.findSchoolsForFranchise's
   * own header comment for the full "why this needs a cross-tenant read mechanism at
   * all" reasoning. Returns a plain array in the same items/nextCursor envelope every
   * other list endpoint uses (SchoolListResponseDto), with `nextCursor` always null
   * this phase — see that method's own comment on why cursor pagination isn't wired
   * up for this bounded roster view. No cast to the response DTO's shape, same as
   * every other controller method in this codebase (e.g. SchoolsController.findAll)
   * — `@ApiOkResponse` only drives Swagger/api-client generation, and Prisma's own
   * `School[]` already matches SchoolResponseDto structurally at the JSON-serialized
   * boundary (Date fields serialize to ISO strings automatically).
   *
   * Phase 47 — rejected outright for an active impersonation session, not merely
   * scoped down. `franchise_member_schools()` (the SECURITY DEFINER function behind
   * FranchisesService.findSchoolsForFranchise) is a purpose-built cross-tenant read,
   * deliberately NOT an RLS policy at all (see school_tenant_isolation's own Phase 1
   * comment) — the impersonation-scope RLS fix (migration
   * 20261002000000_impersonation_scope_rls_fix) narrows RoleGrant's own policies and
   * everything that reaches RoleGrant through them, but this function bypasses RLS by
   * design and returns every School under a Franchise with no way to further narrow
   * that to "just the one School impersonation was scoped to" without changing its
   * whole contract. Blocking it here is the same "narrower than a real login, not
   * silently equivalent to one" posture Decision 102 already established for writes.
   */
  @ApiOkResponse({ type: FranchiseMemberSchoolListResponseDto })
  @Get(':id/schools')
  async findSchools(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    if (user.impersonation) {
      throw new ForbiddenException(
        // Decision 39
        'The Franchise School roster is not available during an impersonation session.',
      );
    }
    const items = await this.franchisesService.findSchoolsForFranchise(user.sub, id);
    return { items, nextCursor: null };
  }

  /** Decision 352 — Schools asking to join; Franchise Owner only. */
  @ApiOkResponse({ type: FranchiseJoinRequestListResponseDto })
  @Get(':id/join-requests')
  listJoinRequests(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.franchisesService.listJoinRequests(user.sub, id);
  }

  /** Decision 352 — accept: the School joins this Franchise. */
  @ApiOkResponse({ type: FranchiseJoinRequestResponseDto })
  @HttpCode(200)
  @Post(':id/join-requests/:requestId/accept')
  acceptJoinRequest(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.franchisesService.decideJoinRequest(user.sub, id, requestId, true);
  }

  /** Decision 352 — decline: the School stays independent and can ask again. */
  @ApiOkResponse({ type: FranchiseJoinRequestResponseDto })
  @HttpCode(200)
  @Post(':id/join-requests/:requestId/decline')
  declineJoinRequest(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.franchisesService.decideJoinRequest(user.sub, id, requestId, false);
  }

  /** Decision 352 — the Franchise Owner removes a member School (the same
   * result as the School leaving). Not during impersonation. */
  @ApiOkResponse({ type: RemoveFranchiseSchoolResponseDto })
  @HttpCode(200)
  @Post(':id/schools/:schoolId/remove')
  removeSchool(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    if (user.impersonation) {
      // Decision 39
      throw new ForbiddenException('Removing a School is not available during an impersonation session.');
    }
    return this.franchisesService.removeSchool(user.sub, id, schoolId);
  }

  /** Decision 352 — the Franchise Owner closes their own Franchise, with its
   * name re-typed and a passcode check. Not during impersonation. */
  @ApiOkResponse({ type: FranchiseResponseDto })
  @ApiHeader({ name: 'x-step-up-token', required: true, description: 'From POST /auth/step-up/verify (passcode check).' })
  @HttpCode(200)
  @Post(':id/close')
  closeOwnFranchise(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CloseOwnFranchiseDto,
    @Headers('x-step-up-token') stepUpToken?: string,
  ) {
    if (user.impersonation) {
      // Decision 39
      throw new ForbiddenException('Closing a Franchise is not available during an impersonation session.');
    }
    return this.franchisesService.closeOwnFranchise(user.sub, id, dto, stepUpToken);
  }
}
