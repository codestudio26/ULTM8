import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { PlatformAdminSchoolsService } from './platform-admin-schools.service';
import { PlatformAdminJwtAuthGuard } from './guards/platform-admin-jwt-auth.guard';
import { CurrentAdminUser } from './decorators/current-admin-user.decorator';
import { AdminJwtPayload } from './interfaces/admin-jwt-payload.interface';
import { SchoolResponseDto } from '../tenants/schools/dto/school-response.dto';
import { PlatformAdminSchoolOwnersService } from './platform-admin-school-owners.service';
import { ChangeSchoolMainOwnerDto, SchoolOwnersResponseDto } from './dto/school-owners.dto';

class ChangeSchoolMainOwnerResponseDto {
  @ApiProperty()
  mainOwnerUserId!: string;

  @ApiProperty()
  formerMainOwnerRemoved!: boolean;
}

/** Slice 2 of PlatformAdminModule — see PlatformAdminSchoolsService's own header
 * comment for scope. Reuses SchoolResponseDto directly (not a hand-rolled
 * duplicate) — the columns ultm8_platform_admin is granted are an exact field-for-
 * field match of that DTO already, minus the School-owner-only `accessToken`. */
@ApiTags('platform-admin-schools')
@ApiBearerAuth()
@UseGuards(PlatformAdminJwtAuthGuard)
@Controller('platform-admin/schools')
export class PlatformAdminSchoolsController {
  constructor(
    private readonly platformAdminSchools: PlatformAdminSchoolsService,
    private readonly schoolOwners: PlatformAdminSchoolOwnersService,
  ) {}

  @ApiOkResponse({ type: SchoolResponseDto })
  @Get(':id')
  findOne(@CurrentAdminUser() admin: AdminJwtPayload, @Param('id') id: string) {
    return this.platformAdminSchools.findOne(admin.sub, id);
  }

  /** Decision 370 — see PlatformAdminSchoolOwnersService. */
  @ApiOkResponse({ type: SchoolOwnersResponseDto })
  @Get(':id/owners')
  listOwners(@CurrentAdminUser() admin: AdminJwtPayload, @Param('id') id: string) {
    return this.schoolOwners.listOwners(admin.sub, id);
  }

  @ApiCreatedResponse({ type: ChangeSchoolMainOwnerResponseDto })
  @Post(':id/main-owner')
  changeMainOwner(@CurrentAdminUser() admin: AdminJwtPayload, @Param('id') id: string, @Body() dto: ChangeSchoolMainOwnerDto) {
    return this.schoolOwners.changeMainOwner(admin.sub, id, dto);
  }
}
