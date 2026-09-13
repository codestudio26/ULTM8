import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PlatformAdminUsersService } from './platform-admin-users.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { AdminUserListResponseDto, AdminUserResponseDto } from './dto/admin-user-response.dto';
import { PlatformAdminJwtAuthGuard } from './guards/platform-admin-jwt-auth.guard';
import { CurrentAdminUser } from './decorators/current-admin-user.decorator';
import { AdminJwtPayload } from './interfaces/admin-jwt-payload.interface';

/** Slice 4 of PlatformAdminModule — see PlatformAdminUsersService's own header
 * comment for scope. Both routes are FULL_ADMIN-only (enforced in the service,
 * not the guard — see that service's own assertFullAdmin, mirroring how
 * TenantAuthorizationService centralizes its own assertXxx checks rather than
 * scattering them across controllers). */
@ApiTags('platform-admin-users')
@ApiBearerAuth()
@UseGuards(PlatformAdminJwtAuthGuard)
@Controller('platform-admin/admin-users')
export class PlatformAdminUsersController {
  constructor(private readonly platformAdminUsers: PlatformAdminUsersService) {}

  @ApiCreatedResponse({ type: AdminUserResponseDto })
  @Post()
  create(@CurrentAdminUser() admin: AdminJwtPayload, @Body() dto: CreateAdminUserDto) {
    return this.platformAdminUsers.create(admin.sub, dto);
  }

  @ApiOkResponse({ type: AdminUserListResponseDto })
  @Get()
  async findAll(@CurrentAdminUser() admin: AdminJwtPayload) {
    const items = await this.platformAdminUsers.findAll(admin.sub);
    return { items };
  }
}
