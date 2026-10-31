import { Module } from '@nestjs/common';
import { AddressLookupController } from './address-lookup.controller';
import { AddressLookupService } from './address-lookup.service';
import { PLACES_HTTP, nodePlacesHttp } from './places-http';

/** Google Places street lookup (Decision 212). See AddressLookupService. */
@Module({
  controllers: [AddressLookupController],
  providers: [AddressLookupService, { provide: PLACES_HTTP, useValue: nodePlacesHttp }],
})
export class AddressLookupModule {}
