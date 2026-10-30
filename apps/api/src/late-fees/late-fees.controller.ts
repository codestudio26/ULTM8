import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { LateFeesService } from './late-fees.service';
import { LateFeeSettingsDto, UpdateLateFeeSettingsDto } from './dto/late-fee.dto';

/** The School owner's late-fee setting (Decision 413). Owner only. Waiving a
 * late fee is on the charges API (POST schools/{id}/charges/{id}/waive-late-fee). */
@ApiTags('late-fees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class LateFeesController {
  constructor(private readonly lateFees: LateFeesService) {}

  @ApiOkResponse({ type: LateFeeSettingsDto })
  @Get('schools/:schoolId/late-fees')
  get(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.lateFees.getSettings(user.sub, schoolId);
  }

  @ApiOkResponse({ type: LateFeeSettingsDto })
  @Put('schools/:schoolId/late-fees')
  update(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: UpdateLateFeeSettingsDto) {
    return this.lateFees.updateSettings(user.sub, schoolId, dto);
  }
}
