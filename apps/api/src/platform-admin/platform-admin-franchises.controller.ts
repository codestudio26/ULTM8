import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PlatformAdminFranchisesService } from './platform-admin-franchises.service';
import { PlatformAdminJwtAuthGuard } from './guards/platform-admin-jwt-auth.guard';
import { CurrentAdminUser } from './decorators/current-admin-user.decorator';
import { AdminJwtPayload } from './interfaces/admin-jwt-payload.interface';
import { FranchiseResponseDto } from '../tenants/franchises/dto/franchise-response.dto';

/** Slice 3 of PlatformAdminModule — mirrors platform-admin-schools.controller.ts.
 * Reuses FranchiseResponseDto directly — the columns ultm8_platform_admin is
 * granted match that DTO exactly (see PLATFORM_ADMIN_FRANCHISE_SELECT's own
 * header comment). */
@ApiTags('platform-admin-franchises')
@ApiBearerAuth()
@UseGuards(PlatformAdminJwtAuthGuard)
@Controller('platform-admin/franchises')
export class PlatformAdminFranchisesController {
  constructor(private readonly platformAdminFranchises: PlatformAdminFranchisesService) {}

  @ApiOkResponse({ type: FranchiseResponseDto })
  @Get(':id')
  findOne(@CurrentAdminUser() admin: AdminJwtPayload, @Param('id') id: string) {
    return this.platformAdminFranchises.findOne(admin.sub, id);
  }
}
