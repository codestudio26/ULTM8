import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { GuardiansService } from './guardians.service';
import { CreateMinorDto } from './dto/create-minor.dto';
import { GrantConsentDto } from './dto/grant-consent.dto';
import { MinorListResponseDto, MinorResponseDto, ConsentRecordListResponseDto, ConsentRecordResponseDto } from './dto/guardian-response.dto';

// Phase 12 scope only: linking a minor + two-tier consent grant/withdraw. See
// GuardiansService's own header comment for the full scoping rationale. All
// routes act on the CALLING Guardian's own data only ("me") — no on-behalf-of
// shape for any other caller, unlike Booking's Staff-override pattern; nothing
// in SKILL.md §14 confirms any other role can act on a Guardian's own links or
// consent.
@ApiTags('guardians')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('guardians/me')
export class GuardiansController {
  constructor(private readonly guardiansService: GuardiansService) {}

  @ApiCreatedResponse({ type: MinorResponseDto })
  @Post('minors')
  createMinor(@CurrentUser() user: JwtPayload, @Body() dto: CreateMinorDto) {
    return this.guardiansService.createMinor(user.sub, dto);
  }

  @ApiOkResponse({ type: MinorListResponseDto })
  @Get('minors')
  findMyMinors(@CurrentUser() user: JwtPayload) {
    return this.guardiansService.findMyMinors(user.sub);
  }

  @ApiCreatedResponse({ type: ConsentRecordResponseDto })
  @Post('minors/:studentId/consent')
  grantConsent(@CurrentUser() user: JwtPayload, @Param('studentId') studentId: string, @Body() dto: GrantConsentDto) {
    return this.guardiansService.grantConsent(user.sub, studentId, dto);
  }

  @ApiOkResponse({ type: ConsentRecordListResponseDto })
  @Get('consent')
  findMyConsentRecords(@CurrentUser() user: JwtPayload) {
    return this.guardiansService.findMyConsentRecords(user.sub);
  }

  @ApiOkResponse({ type: ConsentRecordResponseDto })
  @Patch('consent/:id/withdraw')
  withdrawConsent(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.guardiansService.withdrawConsent(user.sub, id);
  }
}
