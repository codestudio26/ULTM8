import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { jwtSubTracker } from '../common/throttle/identity-trackers';
import { AddressLookupService } from './address-lookup.service';
import {
  AddressAutocompleteQueryDto,
  AddressAutocompleteResponseDto,
  AddressDetailsQueryDto,
  AddressDetailsResponseDto,
  AddressLookupStatusDto,
} from './dto/address-lookup.dto';

// Per signed-in user. Suggestions are asked for as the person types (the apps
// wait for a pause first), so a minute of steady typing stays well under 60;
// each Google call costs money, so a runaway client is stopped here.
const AUTOCOMPLETE_THROTTLE = { identity: { limit: 60, ttl: 60_000, getTracker: jwtSubTracker } };
const DETAILS_THROTTLE = { identity: { limit: 20, ttl: 60_000, getTracker: jwtSubTracker } };

/**
 * Google Places street lookup for the address forms (Decision 212), for any
 * signed-in user. Switched off until the server has `GOOGLE_PLACES_API_KEY`.
 */
@ApiTags('address-lookup')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('address-lookup')
export class AddressLookupController {
  constructor(private readonly lookup: AddressLookupService) {}

  /** Whether street lookup is switched on. The apps only show the search box when it is. */
  @ApiOkResponse({ type: AddressLookupStatusDto })
  @Get('status')
  status(): AddressLookupStatusDto {
    return this.lookup.status();
  }

  /** Address suggestions for what has been typed. The language is `language`, else the request's Accept-Language. 503 ADDRESS_LOOKUP_NOT_CONFIGURED while switched off. */
  @ApiOkResponse({ type: AddressAutocompleteResponseDto })
  @Throttle(AUTOCOMPLETE_THROTTLE)
  @Get('autocomplete')
  autocomplete(@Query() query: AddressAutocompleteQueryDto, @Req() req: Request) {
    return this.lookup.autocomplete(query, req.headers['accept-language']);
  }

  /** The chosen suggestion as a structured address. 503 ADDRESS_LOOKUP_NOT_CONFIGURED while switched off. */
  @ApiOkResponse({ type: AddressDetailsResponseDto })
  @Throttle(DETAILS_THROTTLE)
  @Get('details')
  details(@Query() query: AddressDetailsQueryDto, @Req() req: Request) {
    return this.lookup.details(query, req.headers['accept-language']);
  }
}
