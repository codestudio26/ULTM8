import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PlatformAdminJwtAuthGuard } from '../platform-admin/guards/platform-admin-jwt-auth.guard';
import { CurrentAdminUser } from '../platform-admin/decorators/current-admin-user.decorator';
import { AdminJwtPayload } from '../platform-admin/interfaces/admin-jwt-payload.interface';
import { CardSurchargeService } from './card-surcharge.service';
import { AddCardSurchargeCountryDto, CardSurchargeCountryDto, CardSurchargeCountryListDto } from './dto/card-surcharge.dto';

/** Decision 406: the countries where a School may add a card surcharge.
 * Any admin reads the list; Billing/Payments Ops and Full Admins change it
 * (checked in CardSurchargeService), and every change is audit-logged. */
@ApiTags('platform-admin-card-surcharge')
@ApiBearerAuth()
@UseGuards(PlatformAdminJwtAuthGuard)
@Controller('platform-admin/card-surcharge-countries')
export class PlatformAdminCardSurchargeController {
  constructor(private readonly cardSurcharge: CardSurchargeService) {}

  @ApiOkResponse({ type: CardSurchargeCountryListDto })
  @Get()
  list() {
    return this.cardSurcharge.listCountries();
  }

  @ApiCreatedResponse({ type: CardSurchargeCountryDto })
  @Post()
  add(@CurrentAdminUser() admin: AdminJwtPayload, @Body() dto: AddCardSurchargeCountryDto) {
    return this.cardSurcharge.addCountry(admin.sub, dto.countryCode);
  }

  @ApiNoContentResponse()
  @HttpCode(204)
  @Delete(':countryCode')
  remove(@CurrentAdminUser() admin: AdminJwtPayload, @Param('countryCode') countryCode: string) {
    return this.cardSurcharge.removeCountry(admin.sub, countryCode);
  }
}
