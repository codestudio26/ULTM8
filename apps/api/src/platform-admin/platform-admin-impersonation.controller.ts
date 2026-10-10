import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { PlatformAdminJwtAuthGuard } from './guards/platform-admin-jwt-auth.guard';
import { CurrentAdminUser } from './decorators/current-admin-user.decorator';
import { AdminJwtPayload } from './interfaces/admin-jwt-payload.interface';
import { PlatformAdminImpersonationService } from './platform-admin-impersonation.service';
import { StartImpersonationSessionDto } from './dto/start-impersonation-session.dto';
import { ImpersonationSessionResponseDto } from './dto/impersonation-session-response.dto';

/** Slice 8 (Phase 43) of PlatformAdminModule — see
 * PlatformAdminImpersonationService's own header comment for scope/reasoning.
 * SUPPORT/FULL_ADMIN-only, enforced in the service, not the guard — same
 * convention every other subRole-gated route in this module already uses. */
@ApiTags('platform-admin-impersonation')
@ApiBearerAuth()
@UseGuards(PlatformAdminJwtAuthGuard)
@Controller()
export class PlatformAdminImpersonationController {
  constructor(private readonly impersonation: PlatformAdminImpersonationService) {}

  @ApiCreatedResponse({ type: ImpersonationSessionResponseDto })
  @Post('platform-admin/impersonation-sessions')
  start(@CurrentAdminUser() admin: AdminJwtPayload, @Body() dto: StartImpersonationSessionDto) {
    return this.impersonation.startSession(admin.sub, dto);
  }
}
