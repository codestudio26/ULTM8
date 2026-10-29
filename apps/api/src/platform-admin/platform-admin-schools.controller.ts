import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { PlatformAdminSchoolsService } from './platform-admin-schools.service';
import { PlatformAdminJwtAuthGuard } from './guards/platform-admin-jwt-auth.guard';
import { CurrentAdminUser } from './decorators/current-admin-user.decorator';
import { AdminJwtPayload } from './interfaces/admin-jwt-payload.interface';
import { SchoolResponseDto } from '../tenants/schools/dto/school-response.dto';
import { PlatformAdminSchoolOwnersService } from './platform-admin-school-owners.service';
import { ChangeSchoolMainOwnerDto, SchoolOwnersResponseDto } from './dto/school-owners.dto';
import { PlatformAdminSchoolTrialService } from './platform-admin-school-trial.service';
import { SchoolTrialDaysDto, SchoolTrialResponseDto } from './dto/school-trial.dto';

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
    private readonly schoolTrial: PlatformAdminSchoolTrialService,
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

  /** Backlog 3.14 — see PlatformAdminSchoolTrialService. */
  @ApiOkResponse({ type: SchoolTrialResponseDto })
  @HttpCode(200)
  @Post(':id/trial')
  startTrial(@CurrentAdminUser() admin: AdminJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SchoolTrialDaysDto) {
    return this.schoolTrial.start(admin.sub, id, dto.days);
  }

  @ApiOkResponse({ type: SchoolTrialResponseDto })
  @HttpCode(200)
  @Post(':id/trial/extend')
  extendTrial(@CurrentAdminUser() admin: AdminJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SchoolTrialDaysDto) {
    return this.schoolTrial.extend(admin.sub, id, dto.days);
  }
}
