import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { PlatformAdminJwtAuthGuard } from './guards/platform-admin-jwt-auth.guard';
import { CurrentAdminUser } from './decorators/current-admin-user.decorator';
import { AdminJwtPayload } from './interfaces/admin-jwt-payload.interface';
import { CloseTenantAccountDto } from './dto/close-tenant-account.dto';
import { TenantLifecycleStatusDto } from './dto/tenant-lifecycle-status.dto';

/** Phase 56 (Decision 110) — the close-account/reactivate actions for School and
 * Franchise. See TenantLifecycleService's own header comment for the full
 * account. FULL_ADMIN-only, enforced in the service (same convention
 * PlatformAdminUsersController's own header comment documents — the guard only
 * confirms "a Platform Admin," not which subRole). */
@ApiTags('platform-admin-tenant-lifecycle')
@ApiBearerAuth()
@UseGuards(PlatformAdminJwtAuthGuard)
@Controller('platform-admin')
export class PlatformAdminTenantLifecycleController {
  constructor(private readonly tenantLifecycle: TenantLifecycleService) {}

  @ApiOkResponse({ type: TenantLifecycleStatusDto })
  @Post('schools/:id/close')
  closeSchool(
    @CurrentAdminUser() admin: AdminJwtPayload,
    @Param('id') id: string,
    @Body() dto: CloseTenantAccountDto,
  ) {
    return this.tenantLifecycle.closeSchool(admin.sub, id, dto);
  }

  @ApiOkResponse({ type: TenantLifecycleStatusDto })
  @Post('schools/:id/reactivate')
  reactivateSchool(@CurrentAdminUser() admin: AdminJwtPayload, @Param('id') id: string) {
    return this.tenantLifecycle.reactivateSchool(admin.sub, id);
  }

  @ApiOkResponse({ type: TenantLifecycleStatusDto })
  @Post('franchises/:id/close')
  closeFranchise(
    @CurrentAdminUser() admin: AdminJwtPayload,
    @Param('id') id: string,
    @Body() dto: CloseTenantAccountDto,
  ) {
    return this.tenantLifecycle.closeFranchise(admin.sub, id, dto);
  }

  @ApiOkResponse({ type: TenantLifecycleStatusDto })
  @Post('franchises/:id/reactivate')
  reactivateFranchise(@CurrentAdminUser() admin: AdminJwtPayload, @Param('id') id: string) {
    return this.tenantLifecycle.reactivateFranchise(admin.sub, id);
  }
}
