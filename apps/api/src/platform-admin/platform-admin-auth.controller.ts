import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { ExchangeCognitoTokenDto } from './dto/exchange-cognito-token.dto';
import { AdminAuthResponseDto, AdminMeResponseDto } from './dto/admin-auth-response.dto';
import { PlatformAdminJwtAuthGuard } from './guards/platform-admin-jwt-auth.guard';
import { CurrentAdminUser } from './decorators/current-admin-user.decorator';
import { AdminJwtPayload } from './interfaces/admin-jwt-payload.interface';

/** Slice 1 of PlatformAdminModule — see that module's own header comment for scope. */
@ApiTags('platform-admin-auth')
@Controller('platform-admin/auth')
export class PlatformAdminAuthController {
  constructor(private readonly platformAdminAuth: PlatformAdminAuthService) {}

  /**
   * The frontend completes Cognito's own Hosted-UI + Authorization-Code-with-PKCE
   * flow directly against Cognito (this backend is not part of that redirect/code
   * exchange), then hands the resulting ID token here to be verified and mapped to
   * ULTM8's own Platform Admin session — see CognitoTokenVerifierService's own
   * header comment for the full account of why the split is shaped this way.
   */
  @ApiCreatedResponse({ type: AdminAuthResponseDto })
  @Post('exchange')
  async exchange(@Body() dto: ExchangeCognitoTokenDto): Promise<AdminAuthResponseDto> {
    const accessToken = await this.platformAdminAuth.exchangeCognitoToken(dto.idToken);
    return { accessToken };
  }

  /** Deliberately minimal — proves the exchange->guard->claims chain end-to-end;
   * see AdminMeResponseDto's own header comment. */
  @ApiBearerAuth()
  @UseGuards(PlatformAdminJwtAuthGuard)
  @ApiOkResponse({ type: AdminMeResponseDto })
  @Get('me')
  async me(@CurrentAdminUser() admin: AdminJwtPayload): Promise<AdminMeResponseDto> {
    const found = await this.platformAdminAuth.findActiveById(admin.sub);
    return { id: found.id, email: found.email, name: found.name, subRole: found.subRole };
  }
}
