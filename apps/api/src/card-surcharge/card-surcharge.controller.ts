import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CardSurchargeService } from './card-surcharge.service';
import { CardSurchargeSettingsDto, UpdateCardSurchargeSettingsDto } from './dto/card-surcharge.dto';

/** The School owner's card surcharge setting (Decision 406). Owner only. */
@ApiTags('card-surcharge')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class CardSurchargeController {
  constructor(private readonly cardSurcharge: CardSurchargeService) {}

  @ApiOkResponse({ type: CardSurchargeSettingsDto })
  @Get('schools/:schoolId/card-surcharge')
  get(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.cardSurcharge.getSettings(user.sub, schoolId);
  }

  @ApiOkResponse({ type: CardSurchargeSettingsDto })
  @Put('schools/:schoolId/card-surcharge')
  update(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: UpdateCardSurchargeSettingsDto) {
    return this.cardSurcharge.updateSettings(user.sub, schoolId, dto);
  }
}
