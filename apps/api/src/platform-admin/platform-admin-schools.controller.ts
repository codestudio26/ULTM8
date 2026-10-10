import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PlatformAdminSchoolsService } from './platform-admin-schools.service';
import { PlatformAdminJwtAuthGuard } from './guards/platform-admin-jwt-auth.guard';
import { CurrentAdminUser } from './decorators/current-admin-user.decorator';
import { AdminJwtPayload } from './interfaces/admin-jwt-payload.interface';
import { SchoolResponseDto } from '../tenants/schools/dto/school-response.dto';

/** Slice 2 of PlatformAdminModule — see PlatformAdminSchoolsService's own header
 * comment for scope. Reuses SchoolResponseDto directly (not a hand-rolled
 * duplicate) — the columns ultm8_platform_admin is granted are an exact field-for-
 * field match of that DTO already, minus the School-owner-only `accessToken`. */
@ApiTags('platform-admin-schools')
@ApiBearerAuth()
@UseGuards(PlatformAdminJwtAuthGuard)
@Controller('platform-admin/schools')
export class PlatformAdminSchoolsController {
  constructor(private readonly platformAdminSchools: PlatformAdminSchoolsService) {}

  @ApiOkResponse({ type: SchoolResponseDto })
  @Get(':id')
  findOne(@CurrentAdminUser() admin: AdminJwtPayload, @Param('id') id: string) {
    return this.platformAdminSchools.findOne(admin.sub, id);
  }
}
